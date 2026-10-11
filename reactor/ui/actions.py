# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Typed actions: only what a display offered can be pressed.

A plugin registers an action by name with the pydantic model of its payload
and the handler that runs it. When a display offers the action, the server
mints a token over the session, the display id and the action name; the page
sends the token back with the press, and a press whose token does not match
is refused. A page — or anything posing as one — cannot press what it was not
shown.

Every press then goes past :meth:`~reactor.hooks.ReactorHookSpecs.authorize_ui_action`:
any plugin answering ``False`` vetoes it, and a plugin whose hook raises
vetoes it too. Refusals fail closed.

The failures carry the HTTP status a route answers with: an unknown action
or a payload that does not validate is ``422``; a bad token or a veto is
``403``. Nothing unknown is turned into something else — an action nobody
registered is never a chat message.

::

    actions = ActionRegistry(secret, platform=platform)
    actions.register("weather.refresh", Refresh, refresh, plugin="weather")
    display.actions = [actions.offer(session, display.id, "weather.refresh", label="Refresh")]
    ...
    result = await actions.dispatch(principal, session, UiAction.model_validate(body))
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import inspect
import logging
from collections import OrderedDict
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Awaitable, Callable

from pydantic import BaseModel, ValidationError

from .wire import ActionOffer, UiAction

if TYPE_CHECKING:
    from ..reactor import PluginPlatform

logger = logging.getLogger(__name__)


class UiActionError(Exception):
    """A press refused. ``status_code`` is what a route answers with."""

    status_code = 400


class UnknownUiAction(UiActionError):
    """No action of that name is registered."""

    status_code = 422


class UiActionPayloadInvalid(UiActionError):
    """The payload does not validate against the action's model."""

    status_code = 422


class UiActionTokenInvalid(UiActionError):
    """The token was not minted for this session, display and action."""

    status_code = 403


class UiActionRefused(UiActionError):
    """A plugin's ``authorize_ui_action`` said no."""

    status_code = 403


@dataclass(frozen=True)
class UiActionContext:
    """What a handler is told besides its payload."""

    principal: Any
    session: str
    display_id: str
    action: str


#: ``handler(payload, context)``, sync or async.
UiActionHandler = Callable[[Any, UiActionContext], Any | Awaitable[Any]]


@dataclass(frozen=True)
class RegisteredAction:
    name: str
    model: type[BaseModel]
    handler: UiActionHandler
    plugin: str


class ActionRegistry:
    """Actions by name, the tokens that offer them, and the presses that run them.

    ``secret`` keys the tokens; a host keeps it as it keeps any signing key.
    ``platform``, when given, is asked :meth:`PluginPlatform.authorize_ui_action`
    on every press. ``remember`` bounds how many idempotency ids are kept.
    """

    def __init__(
        self,
        secret: bytes,
        *,
        platform: "PluginPlatform | None" = None,
        remember: int = 1024,
    ) -> None:
        if len(secret) < 16:
            raise ValueError("An action secret needs at least 16 bytes")
        self._secret = secret
        self._platform = platform
        self._actions: dict[str, RegisteredAction] = {}
        self._remember = remember
        self._done: OrderedDict[tuple[str, str, str, str], asyncio.Future[Any]] = OrderedDict()

    def register(
        self,
        name: str,
        model: type[BaseModel],
        handler: UiActionHandler,
        plugin: str,
    ) -> Callable[[], None]:
        """Register an action and return what unregisters it."""
        if not name:
            raise ValueError("An action needs a name")
        if name in self._actions:
            raise ValueError(f"Action {name!r} is already registered by {self._actions[name].plugin}")
        registered = RegisteredAction(name=name, model=model, handler=handler, plugin=plugin)
        self._actions[name] = registered

        def dispose() -> None:
            if self._actions.get(name) is registered:
                del self._actions[name]

        return dispose

    def unregister_plugin(self, plugin: str) -> None:
        """Drop every action one plugin registered."""
        for name in [name for name, action in self._actions.items() if action.plugin == plugin]:
            del self._actions[name]

    def names(self) -> list[str]:
        return sorted(self._actions)

    def get(self, name: str) -> RegisteredAction:
        action = self._actions.get(name)
        if action is None:
            raise UnknownUiAction(f"No UI action {name!r} is registered")
        return action

    def mint(self, session: str, display_id: str, action: str) -> str:
        """The token that lets this session press this action on this display."""
        self.get(action)
        message = "\0".join(("reactor.ui/v1", session, display_id, action)).encode()
        digest = hmac.new(self._secret, message, hashlib.sha256).digest()
        return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()

    def offer(self, session: str, display_id: str, action: str, *, label: str | None = None) -> ActionOffer:
        """An action as a display offers it, token included."""
        return ActionOffer(name=action, label=label, token=self.mint(session, display_id, action))

    def authorize(self, principal: Any, session: str, request: UiAction) -> RegisteredAction:
        """Check a press: known, offered, and not vetoed. Returns the action."""
        action = self.get(request.action)
        expected = self.mint(session, request.display_id, request.action)
        if not hmac.compare_digest(expected, request.token):
            raise UiActionTokenInvalid(
                f"{request.action!r} was not offered on display {request.display_id!r} in this session"
            )
        if self._platform is not None and not self._platform.authorize_ui_action(
            principal=principal, session=session, action=request
        ):
            raise UiActionRefused(f"{request.action!r} was refused")
        return action

    async def dispatch(self, principal: Any, session: str, request: UiAction) -> Any:
        """Authorize a press, validate its payload, and run its handler.

        A press repeating an ``idempotency_id`` already answered for the same
        session, display and action gets that answer; the handler runs once.
        A press whose handler raised is forgotten, so a retry runs again.
        """
        action = self.authorize(principal, session, request)
        try:
            payload = action.model.model_validate(request.payload)
        except ValidationError as error:
            raise UiActionPayloadInvalid(f"{request.action!r}: {error}") from error
        context = UiActionContext(
            principal=principal,
            session=session,
            display_id=request.display_id,
            action=request.action,
        )
        if request.idempotency_id is None:
            return await _call(action.handler, payload, context)

        key = (session, request.display_id, request.action, request.idempotency_id)
        pending = self._done.get(key)
        if pending is not None:
            return await asyncio.shield(pending)
        future: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
        self._done[key] = future
        while len(self._done) > self._remember:
            self._done.popitem(last=False)
        try:
            result = await _call(action.handler, payload, context)
        except BaseException as error:
            self._done.pop(key, None)
            future.set_exception(error)
            # Nobody may be waiting on it; say it was seen so asyncio does not.
            future.exception()
            raise
        future.set_result(result)
        return result


async def _call(handler: UiActionHandler, payload: Any, context: UiActionContext) -> Any:
    result = handler(payload, context)
    if inspect.isawaitable(result):
        result = await result
    return result


__all__ = [
    "ActionRegistry",
    "RegisteredAction",
    "UiActionContext",
    "UiActionError",
    "UiActionHandler",
    "UiActionPayloadInvalid",
    "UiActionRefused",
    "UiActionTokenInvalid",
    "UnknownUiAction",
]
