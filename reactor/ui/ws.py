# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""The ui channel over one WebSocket: ops down, presses up (REACTOR_UI RU-W).

A host keeps one :class:`UiHub` — a :class:`~reactor.ui.channel.UiChannel`
its producers emit ops to — and mounts one :class:`UiSocket` on its server.
A page opens one connection per conversation (a scope) and:

1. sends a ``hello`` first — its credential (never in the URL), the scope,
   and ``since``, the last sequence number it applied;
2. receives a ``welcome`` with the scope's last sequence number, the ops it
   missed (every op the hub keeps for the scope when ``since`` is none), then
   every op as it is emitted, each in an ``op`` frame numbered one more than
   the last;
3. sends ``action`` frames (a press of something a display offered, with its
   token and idempotency id) and ``state`` frames, each answered by a
   ``result`` frame with the same ``ref``.

Both sides ping; a side that hears nothing for ``timeout`` seconds closes.
Every frame is checked against the schema; one that is not is refused and the
connection closed with the reason — never ignored. Each connection has a
bounded queue: a page that does not read fast enough is closed (``4429``) and
resumes from its last sequence number, so nothing is lost and nothing is
applied twice.

Close codes:

``4400``
    A frame that is not the schema's, or a first frame that is not a hello.
``4401``
    The hello's credential refused.
``4403``
    The credential is good, the scope is not theirs.
``4408``
    No hello in time, or nothing heard for ``timeout`` seconds.
``4410``
    ``since`` is older than what the hub keeps, or newer than what it has:
    the page cannot resume, and draws the conversation again from its host.
``4429``
    The page's queue overflowed: it reconnects with ``since``.

Two tabs on one conversation are two connections on one scope: each receives
every op, each press is answered on the connection it came from.
"""

from __future__ import annotations

import asyncio
import inspect
import logging
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from pydantic import TypeAdapter, ValidationError
from starlette.websockets import WebSocket

from .actions import UiActionError
from .channel import parse_op
from .wire import (
    ActionFrame,
    DownFrame,
    HelloFrame,
    OpFrame,
    PatchOperation,
    PingFrame,
    PongFrame,
    ResultFrame,
    StateFrame,
    UiAction,
    UiOp,
    UpFrame,
    WelcomeFrame,
)

logger = logging.getLogger(__name__)

#: The WebSocket subprotocol a page asks for.
UI_WS_PROTOCOL = "reactor.ui.v1"

CLOSE_REFUSED = 4400
CLOSE_UNAUTHORIZED = 4401
CLOSE_FORBIDDEN = 4403
CLOSE_TIMEOUT = 4408
CLOSE_GONE = 4410
CLOSE_SLOW = 4429

_UP: TypeAdapter[Any] = TypeAdapter(UpFrame)
_DOWN: TypeAdapter[Any] = TypeAdapter(DownFrame)


class UiSocketRefused(Exception):
    """A connection refused: ``code`` is the close code, the message its reason."""

    def __init__(self, code: int, reason: str) -> None:
        super().__init__(reason)
        self.code = code
        self.reason = reason


def _reason(text: str) -> str:
    """A close reason fits in 123 bytes of UTF-8."""
    encoded = text.encode()
    if len(encoded) <= 123:
        return text
    return encoded[:120].decode(errors="ignore") + "…"


def dump_frame(frame: Any) -> str:
    """A down frame as the socket sends it."""
    return _DOWN.dump_json(frame, by_alias=True).decode()


def parse_up(text: str | bytes) -> Any:
    """An up frame from its JSON, checked. Raises ``ValueError`` for anything else."""
    try:
        return _UP.validate_json(text)
    except ValidationError as error:
        first = error.errors()[0] if error.errors() else {}
        where = ".".join(str(part) for part in first.get("loc", ()))
        raise ValueError(f"not a reactor.ui frame: {where} {first.get('msg', '')}".strip()) from None


# --- the hub ---------------------------------------------------------------------


@dataclass
class _Scope:
    seq: int = 0
    log: deque[OpFrame] = field(default_factory=deque)
    subscribers: set["Subscription"] = field(default_factory=set)


class Subscription:
    """One connection's view of a scope: the frames waiting to be sent."""

    def __init__(self, hub: "UiHub", scope: str, size: int) -> None:
        self.hub = hub
        self.scope = scope
        self.queue: asyncio.Queue[Any] = asyncio.Queue(maxsize=size)
        self.overflowed = asyncio.Event()

    def offer(self, frame: Any) -> bool:
        """Queue a frame; ``False``, and the subscription marked overflowed, when full."""
        if self.overflowed.is_set():
            return False
        try:
            self.queue.put_nowait(frame)
        except asyncio.QueueFull:
            self.overflowed.set()
            return False
        return True

    def close(self) -> None:
        self.hub._unsubscribe(self)


class UiHub:
    """Ops by scope, numbered and kept, handed to whoever is connected.

    ``keep`` bounds how many ops of a scope are kept for a resume; ``queue``
    how many frames one connection may have waiting.
    """

    def __init__(self, *, keep: int = 10_000, queue: int = 1_024) -> None:
        if keep < 1 or queue < 1:
            raise ValueError("keep and queue must be at least 1")
        self._keep = keep
        self._queue = queue
        self._scopes: dict[str, _Scope] = {}

    def emit(self, op: UiOp | dict[str, Any]) -> int:
        """Number an op, keep it, and hand it to every connection on its scope."""
        checked = parse_op(op)
        scope = self._scopes.setdefault(checked.scope, _Scope())
        scope.seq += 1
        frame = OpFrame(t="op", seq=scope.seq, op=checked)
        scope.log.append(frame)
        while len(scope.log) > self._keep:
            scope.log.popleft()
        for subscriber in list(scope.subscribers):
            subscriber.offer(frame)
        return scope.seq

    def last(self, scope: str) -> int:
        """The scope's last sequence number, 0 before any op."""
        known = self._scopes.get(scope)
        return known.seq if known else 0

    def ops(self, scope: str, since: int = 0) -> list[OpFrame]:
        """The kept ops of a scope after ``since``."""
        known = self._scopes.get(scope)
        return [frame for frame in known.log if frame.seq > since] if known else []

    def subscribe(self, scope: str, since: int | None) -> tuple[Subscription, int]:
        """A connection on a scope, the ops after ``since`` already queued.

        Returns the subscription and the scope's last sequence number. Raises
        :class:`UiSocketRefused` (``4410``) when the ops after ``since`` are
        no longer all kept, or ``since`` is past the last.
        """
        known = self._scopes.setdefault(scope, _Scope())
        if since is not None:
            if since > known.seq:
                raise UiSocketRefused(CLOSE_GONE, f"since {since} is past {scope}'s last op {known.seq}")
            oldest = known.log[0].seq if known.log else known.seq + 1
            if since + 1 < oldest:
                raise UiSocketRefused(CLOSE_GONE, f"the ops of {scope} after {since} are no longer kept")
        elif known.log and known.log[0].seq > 1:
            raise UiSocketRefused(CLOSE_GONE, f"the first ops of {scope} are no longer kept")
        replay = self.ops(scope, since or 0)
        subscription = Subscription(self, scope, max(self._queue, len(replay) + 1))
        for frame in replay:
            subscription.offer(frame)
        known.subscribers.add(subscription)
        return subscription, known.seq

    def connected(self, scope: str) -> int:
        """How many connections are on a scope."""
        known = self._scopes.get(scope)
        return len(known.subscribers) if known else 0

    def forget(self, scope: str) -> None:
        """Drop a scope's ops (its conversation ended). Its connections stay
        until they close; a resume of them is refused."""
        known = self._scopes.pop(scope, None)
        if known is not None:
            for subscriber in list(known.subscribers):
                subscriber.overflowed.set()

    def _unsubscribe(self, subscription: Subscription) -> None:
        known = self._scopes.get(subscription.scope)
        if known is not None:
            known.subscribers.discard(subscription)


# --- the endpoint ----------------------------------------------------------------

#: ``authenticate(token, scope)`` → the principal, sync or async. Raise
#: :class:`UiSocketRefused` to refuse; anything else it raises refuses with 4401.
Authenticate = Callable[[str, str], Any]

#: ``on_action(principal, scope, action)`` → a JSON value, sync or async; a
#: :class:`~reactor.ui.actions.UiActionError` is answered with its status.
OnAction = Callable[[Any, str, UiAction], Any]

#: ``on_state(principal, scope, operations)``, sync or async.
OnState = Callable[[Any, str, list[PatchOperation]], Any]


async def _call(function: Callable[..., Any], *args: Any) -> Any:
    result = function(*args)
    if inspect.isawaitable(result):
        result = await result
    return result


class UiSocket:
    """The ASGI WebSocket endpoint of a :class:`UiHub`.

    Mount ``socket.endpoint`` as a Starlette or FastAPI WebSocket route.
    ``on_state`` absent, a state frame is answered 422: the host reads none.
    """

    def __init__(
        self,
        hub: UiHub,
        *,
        authenticate: Authenticate,
        on_action: OnAction,
        on_state: OnState | None = None,
        heartbeat: float = 20.0,
        timeout: float = 60.0,
        hello_timeout: float = 10.0,
        in_flight: int = 16,
    ) -> None:
        self.hub = hub
        self._authenticate = authenticate
        self._on_action = on_action
        self._on_state = on_state
        self.heartbeat = heartbeat
        self.timeout = timeout
        self.hello_timeout = hello_timeout
        self.in_flight = in_flight

    async def endpoint(self, websocket: WebSocket) -> None:
        """Serve one connection (a Starlette ``WebSocket``)."""
        requested = websocket.scope.get("subprotocols") or []
        await websocket.accept(subprotocol=UI_WS_PROTOCOL if UI_WS_PROTOCOL in requested else None)
        try:
            hello = await self._hello(websocket)
            principal = await self._who(hello)
            subscription, seq = self.hub.subscribe(hello.scope, hello.since)
        except UiSocketRefused as refused:
            await _close(websocket, refused.code, refused.reason)
            return
        try:
            await self._serve(websocket, principal, hello, subscription, seq)
        finally:
            subscription.close()

    async def _hello(self, websocket: Any) -> HelloFrame:
        try:
            message = await asyncio.wait_for(websocket.receive(), self.hello_timeout)
        except asyncio.TimeoutError:
            raise UiSocketRefused(CLOSE_TIMEOUT, "no hello in time") from None
        frame = _frame_of(message)
        if not isinstance(frame, HelloFrame):
            raise UiSocketRefused(CLOSE_REFUSED, "the first frame is a hello")
        return frame

    async def _who(self, hello: HelloFrame) -> Any:
        try:
            return await _call(self._authenticate, hello.token, hello.scope)
        except UiSocketRefused:
            raise
        except Exception as error:  # noqa: BLE001 - fails closed
            logger.info("reactor.ui socket: hello refused: %s", error)
            raise UiSocketRefused(CLOSE_UNAUTHORIZED, "not authenticated") from None

    async def _serve(
        self,
        websocket: Any,
        principal: Any,
        hello: HelloFrame,
        subscription: Subscription,
        seq: int,
    ) -> None:
        heard = time.monotonic()
        closing: list[tuple[int, str]] = []
        pending: set[asyncio.Task[Any]] = set()
        send_lock = asyncio.Lock()

        async def send(frame: Any) -> None:
            async with send_lock:
                await websocket.send_text(dump_frame(frame))

        async def answer(ref: str, work: Callable[[], Awaitable[Any]]) -> None:
            try:
                value = await work()
                result = ResultFrame(t="result", ref=ref, ok=True, status=200, value=value)
            except UiActionError as refused:
                result = ResultFrame(
                    t="result",
                    ref=ref,
                    ok=False,
                    status=refused.status_code,
                    detail=str(refused),
                )
            except Exception:  # noqa: BLE001 - answered, logged
                logger.exception("reactor.ui socket: %s failed on %s", ref, hello.scope)
                result = ResultFrame(t="result", ref=ref, ok=False, status=500, detail="It failed.")
            subscription.offer(result)

        async def reader() -> None:
            nonlocal heard
            while True:
                message = await websocket.receive()
                if message.get("type") == "websocket.disconnect":
                    return
                frame = _frame_of(message)
                heard = time.monotonic()
                if isinstance(frame, PingFrame):
                    subscription.offer(PongFrame(t="pong"))
                elif isinstance(frame, PongFrame):
                    continue
                elif isinstance(frame, HelloFrame):
                    raise UiSocketRefused(CLOSE_REFUSED, "hello is sent once")
                elif len(pending) >= self.in_flight:
                    subscription.offer(
                        ResultFrame(
                            t="result",
                            ref=frame.ref,
                            ok=False,
                            status=429,
                            detail=f"{len(pending)} are still running: send it again once one has answered",
                        )
                    )
                elif isinstance(frame, ActionFrame):
                    press = frame.action
                    task = asyncio.create_task(
                        answer(
                            frame.ref,
                            lambda: _call(self._on_action, principal, hello.scope, press),
                        )
                    )
                    pending.add(task)
                    task.add_done_callback(pending.discard)
                elif isinstance(frame, StateFrame):
                    body = frame.body
                    if self._on_state is None:
                        subscription.offer(
                            ResultFrame(
                                t="result",
                                ref=frame.ref,
                                ok=False,
                                status=422,
                                detail="This host reads no page state.",
                            )
                        )
                        continue
                    on_state = self._on_state
                    task = asyncio.create_task(
                        answer(
                            frame.ref,
                            lambda: _call(on_state, principal, hello.scope, body),
                        )
                    )
                    pending.add(task)
                    task.add_done_callback(pending.discard)

        async def writer() -> None:
            # The welcome first, then the ops replayed, then the live ones.
            await send(WelcomeFrame(t="welcome", scope=hello.scope, seq=seq))
            while True:
                if subscription.overflowed.is_set():
                    raise UiSocketRefused(CLOSE_SLOW, "too slow: resume from your last op")
                try:
                    frame = await asyncio.wait_for(subscription.queue.get(), self.heartbeat)
                except asyncio.TimeoutError:
                    if time.monotonic() - heard > self.timeout:
                        raise UiSocketRefused(CLOSE_TIMEOUT, "nothing heard") from None
                    await send(PingFrame(t="ping"))
                    continue
                await send(frame)

        async def overflow() -> None:
            await subscription.overflowed.wait()
            raise UiSocketRefused(CLOSE_SLOW, "too slow: resume from your last op")

        tasks = [asyncio.create_task(job()) for job in (reader, writer, overflow)]
        try:
            done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for task in done:
                error = task.exception()
                if isinstance(error, UiSocketRefused):
                    closing.append((error.code, error.reason))
                elif error is not None and not _disconnected(error):
                    logger.error("reactor.ui socket on %s: %r", hello.scope, error)
                    closing.append((1011, "the host failed"))
        finally:
            for task in [*tasks, *pending]:
                task.cancel()
        if closing:
            await _close(websocket, *closing[0])


def _disconnected(error: BaseException) -> bool:
    return type(error).__name__ in ("WebSocketDisconnect", "ClientDisconnected")


def _frame_of(message: dict[str, Any]) -> Any:
    """The up frame a received message holds, or refused."""
    kind = message.get("type")
    if kind == "websocket.disconnect":
        raise UiSocketRefused(1000, "gone")
    text = message.get("text")
    if text is None:
        raise UiSocketRefused(CLOSE_REFUSED, "frames are JSON text")
    try:
        return parse_up(text)
    except ValueError as error:
        raise UiSocketRefused(CLOSE_REFUSED, str(error)) from None


async def _close(websocket: Any, code: int, reason: str) -> None:
    try:
        await websocket.close(code=code, reason=_reason(reason))
    except Exception:  # noqa: BLE001 - it may be gone already
        pass


__all__ = [
    "CLOSE_FORBIDDEN",
    "CLOSE_GONE",
    "CLOSE_REFUSED",
    "CLOSE_SLOW",
    "CLOSE_TIMEOUT",
    "CLOSE_UNAUTHORIZED",
    "UI_WS_PROTOCOL",
    "Subscription",
    "UiHub",
    "UiSocket",
    "UiSocketRefused",
    "dump_frame",
    "parse_up",
]
