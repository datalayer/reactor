# Copyright (c) 2026-Present Datalayer, Inc.
#
# BSD 3-Clause License

"""The host side of the loop, without HTTP: request, emit, offer, dispatch.

An :class:`ApprovalDesk` owns a plugin platform with the approval plugin on
it, an :class:`~reactor.ui.ActionRegistry` that mints and checks the tokens,
and a :class:`~reactor.ui.ws.UiHub` the ops go to — numbered and kept per
session, for the page's WebSocket. ``server.py`` mounts the socket in front
of it; the tests drive it directly.
"""

from __future__ import annotations

from typing import Any

from reactor import PluginManifest, PluginPlatform
from reactor.ui import (
    ActionRegistry,
    UiAction,
    UiActionContext,
    UiActionError,
    model_view,
)
from reactor.ui import channel as ui
from reactor.ui.ws import UiHub

from .approval import DECIDE, Approval, ApprovalPlugin, Decide


class AlreadyDecided(UiActionError):
    """The approval was decided already: the token still checks, the press is late."""

    status_code = 409


class ApprovalDesk:
    def __init__(self, secret: bytes) -> None:
        self.platform = PluginPlatform()
        self.platform.register_plugin(
            PluginManifest(name="approvals", version="0.1.0"),
            plugin_impl=ApprovalPlugin(self),
        )
        self.actions = ActionRegistry(secret, platform=self.platform)
        self.actions.register(DECIDE, Decide, self._decide, plugin="approvals")
        self.channel = UiHub()
        self._approvals: dict[str, tuple[str, Approval]] = {}
        #: What a model is told about each decision, in order.
        self.told: list[dict[str, Any]] = []

    def get(self, display_id: str) -> Approval | None:
        found = self._approvals.get(display_id)
        return found[1] if found else None

    def request(self, session: str, approval: Approval) -> Approval:
        """Show an approval in a session, offering the decision on it."""
        approval.actions = [self.actions.offer(session, approval.id, DECIDE, label="Decide")]
        if not any(scope == session for scope, _ in self._approvals.values()):
            ui.meta(self.channel, session, title="Approvals")
        self._approvals[approval.id] = (session, approval)
        ui.show(self.channel, session, approval)
        return approval

    async def press(self, principal: str, session: str, body: dict[str, Any] | UiAction) -> Any:
        """What the page sent, checked and run: the token, the veto, the payload."""
        action = body if isinstance(body, UiAction) else UiAction.model_validate(body)
        return await self.actions.dispatch(principal, session, action)

    def ops(self, session: str) -> list[dict[str, Any]]:
        """The session's ops as JSON, as the page receives them."""
        return [frame.model_dump(mode="json", by_alias=True)["op"] for frame in self.channel.ops(session)]

    def model_view(self, session: str) -> dict[str, Any]:
        """Everything a model is told about a session: its approvals, and the decisions."""
        return {
            "approvals": [approval.model_view() for scope, approval in self._approvals.values() if scope == session],
            "decisions": [told for told in self.told if told["session"] == session],
        }

    def _decide(self, decision: Decide, context: UiActionContext) -> dict[str, Any]:
        session, approval = self._approvals[context.display_id]
        if approval.status != "pending":
            raise AlreadyDecided(f"{approval.title!r} is {approval.status} already")
        approval.status = "approved" if decision.approve else "rejected"
        line = f"{approval.status} by {context.principal}"
        if decision.comment:
            line += f": {decision.comment}"
        approval.history.append(line)
        approval.actions = []

        ui.patch(
            self.channel,
            session,
            approval.id,
            [
                {"op": "replace", "path": "/data/status", "value": approval.status},
                {"op": "replace", "path": "/text", "value": approval.text()},
                {"op": "replace", "path": "/actions", "value": []},
            ],
        )
        ui.append(self.channel, session, approval.id, "/data/history", line)
        ui.state(
            self.channel,
            session,
            [
                {
                    "op": "add",
                    "path": "/last_decision",
                    "value": {"id": approval.id, "status": approval.status},
                }
            ],
        )
        ui.window(
            self.channel,
            session,
            "notify",
            message=f"{approval.title} {approval.status}",
        )

        # The comment is page-only: the model learns what was decided, not what was typed.
        self.told.append(
            {
                "session": session,
                "approval": approval.model_view(),
                "decision": model_view(decision),
                "by": context.principal,
            }
        )
        return {"status": approval.status}


__all__ = ["AlreadyDecided", "ApprovalDesk"]
