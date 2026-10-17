# Copyright (c) 2026-Present Datalayer, Inc.
#
# BSD 3-Clause License

"""The ui channel over one WebSocket (REACTOR_UI RU-W): ordering, resume,
refusal, reconnect, two tabs on one conversation, heartbeats, backpressure,
and presses answered with what the registry says."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from pydantic import BaseModel

from reactor.ui import ActionRegistry, Display, ShowOp, UiAction, display_type
from reactor.ui.ws import (
    CLOSE_FORBIDDEN,
    CLOSE_GONE,
    CLOSE_REFUSED,
    CLOSE_SLOW,
    CLOSE_TIMEOUT,
    CLOSE_UNAUTHORIZED,
    UI_WS_PROTOCOL,
    UiHub,
    UiSocket,
    UiSocketRefused,
    parse_up,
)


@display_type("application/vnd.reactor.test.note+json")
class Note(Display):
    words: str

    def text(self) -> str:
        return self.words


def note(scope: str, words: str, id: str | None = None) -> ShowOp:
    shown = Note(words=words, **({"id": id} if id else {}))
    return ShowOp(scope=scope, id=shown.id, body=shown.wire())


class FakeSocket:
    """A Starlette WebSocket's surface, in this loop."""

    def __init__(self, *, reading: bool = True) -> None:
        self.scope: dict[str, Any] = {"subprotocols": [UI_WS_PROTOCOL]}
        self.incoming: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.sent: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self.accepted: str | None = None
        self.closed: tuple[int, str] | None = None
        self.reading = asyncio.Event()
        if reading:
            self.reading.set()

    async def accept(self, subprotocol: str | None = None) -> None:
        self.accepted = subprotocol

    async def receive(self) -> dict[str, Any]:
        return await self.incoming.get()

    async def send_text(self, text: str) -> None:
        await self.reading.wait()
        await self.sent.put(json.loads(text))

    async def close(self, code: int = 1000, reason: str = "") -> None:
        self.closed = (code, reason)
        await self.sent.put({"closed": code, "reason": reason})

    def say(self, frame: Any) -> None:
        text = frame if isinstance(frame, str) else json.dumps(frame)
        self.incoming.put_nowait({"type": "websocket.receive", "text": text})

    def leave(self) -> None:
        self.incoming.put_nowait({"type": "websocket.disconnect", "code": 1000})

    async def next(self) -> dict[str, Any]:
        return await asyncio.wait_for(self.sent.get(), 2)


def hello(scope: str = "s", token: str = "ada", since: int | None = None) -> dict[str, Any]:
    return {"t": "hello", "v": 1, "token": token, "scope": scope, "since": since}


def authenticate(token: str, scope: str) -> str:
    if token == "intruder":
        raise ValueError("unknown token")
    if scope == "bob-only" and token != "bob":
        raise UiSocketRefused(CLOSE_FORBIDDEN, f"{scope} is not yours")
    return token


async def nothing(principal: Any, scope: str, action: UiAction) -> Any:
    return None


def socket_of(hub: UiHub, **options: Any) -> UiSocket:
    options.setdefault("on_action", nothing)
    return UiSocket(hub, authenticate=authenticate, **options)


async def connect(socket: UiSocket, frame: dict[str, Any], **fake: Any) -> tuple[FakeSocket, asyncio.Task[None]]:
    page = FakeSocket(**fake)
    served = asyncio.create_task(socket.endpoint(page))
    page.say(frame)
    return page, served


async def test_ops_arrive_in_order_numbered_after_a_welcome() -> None:
    hub = UiHub()
    hub.emit(note("s", "one", "a"))
    hub.emit(note("s", "two", "b"))
    hub.emit(note("other", "elsewhere"))
    page, served = await connect(socket_of(hub), hello())
    assert await page.next() == {"t": "welcome", "v": 1, "scope": "s", "seq": 2}
    assert page.accepted == UI_WS_PROTOCOL
    first, second = await page.next(), await page.next()
    assert [(f["seq"], f["op"]["body"]["text"]) for f in (first, second)] == [
        (1, "one"),
        (2, "two"),
    ]
    hub.emit(note("s", "three"))
    live = await page.next()
    assert (live["t"], live["seq"], live["op"]["body"]["data"]) == (
        "op",
        3,
        {"words": "three"},
    )
    page.leave()
    await served
    assert hub.connected("s") == 0


async def test_a_reconnect_resumes_after_its_last_op_none_lost_none_twice() -> None:
    hub = UiHub()
    socket = socket_of(hub)
    page, served = await connect(socket, hello())
    await page.next()
    hub.emit(note("s", "one"))
    hub.emit(note("s", "two"))
    seen = [(await page.next())["seq"] for _ in range(2)]
    page.leave()
    await served
    # Gone, while the conversation goes on.
    hub.emit(note("s", "three"))
    hub.emit(note("s", "four"))
    again, served = await connect(socket, hello(since=seen[-1]))
    assert (await again.next())["seq"] == 4
    resumed = [await again.next(), await again.next()]
    assert [(f["seq"], f["op"]["body"]["text"]) for f in resumed] == [
        (3, "three"),
        (4, "four"),
    ]
    again.leave()
    await served


async def test_a_resume_the_hub_cannot_serve_is_refused_with_gone() -> None:
    hub = UiHub(keep=2)
    for words in ("one", "two", "three", "four"):
        hub.emit(note("s", words))
    socket = socket_of(hub)
    for since in (1, 9):
        page, served = await connect(socket, hello(since=since))
        closed = await page.next()
        await served
        assert closed["closed"] == CLOSE_GONE
    # Nor from the start: its first ops are gone.
    page, served = await connect(socket, hello())
    assert (await page.next())["closed"] == CLOSE_GONE
    await served
    # From an op still kept, it resumes.
    page, served = await connect(socket, hello(since=2))
    assert (await page.next())["seq"] == 4
    assert [(await page.next())["seq"] for _ in range(2)] == [3, 4]
    page.leave()
    await served


@pytest.mark.parametrize(
    "first, code",
    [
        ("not json", CLOSE_REFUSED),
        ({"t": "action", "ref": "r", "action": {}}, CLOSE_REFUSED),
        ({"t": "hello", "token": "ada", "scope": "s", "extra": 1}, CLOSE_REFUSED),
        ({"t": "hello", "v": 2, "token": "ada", "scope": "s"}, CLOSE_REFUSED),
        ({"t": "shout"}, CLOSE_REFUSED),
        (hello(token="intruder"), CLOSE_UNAUTHORIZED),
        (hello(scope="bob-only"), CLOSE_FORBIDDEN),
    ],
)
async def test_a_first_frame_that_is_not_a_good_hello_is_refused(first: Any, code: int) -> None:
    page, served = await connect(socket_of(UiHub()), first)
    closed = await page.next()
    await served
    assert closed["closed"] == code and closed["reason"]


async def test_a_frame_that_is_not_the_schemas_closes_the_connection_with_the_reason() -> None:
    page, served = await connect(socket_of(UiHub()), hello())
    await page.next()
    page.say({"t": "action", "ref": "r", "action": {"action": "a", "display_id": "d"}})
    closed = await page.next()
    await served
    assert closed["closed"] == CLOSE_REFUSED
    assert "action.token" in closed["reason"]
    # A second hello is refused too.
    page, served = await connect(socket_of(UiHub()), hello())
    await page.next()
    page.say(hello())
    assert (await page.next())["closed"] == CLOSE_REFUSED
    await served


async def test_no_hello_in_time_and_nothing_heard_close_the_connection() -> None:
    page = FakeSocket()
    socket = socket_of(UiHub(), hello_timeout=0.05)
    await socket.endpoint(page)
    assert page.closed and page.closed[0] == CLOSE_TIMEOUT
    # Pinged while quiet; closed once nothing is heard.
    page, served = await connect(socket_of(UiHub(), heartbeat=0.02, timeout=0.1), hello())
    await page.next()
    assert (await page.next()) == {"t": "ping"}
    while "closed" not in (frame := await page.next()):
        assert frame == {"t": "ping"}
    await served
    assert frame["closed"] == CLOSE_TIMEOUT


async def test_a_ping_is_answered_and_keeps_the_connection_open() -> None:
    page, served = await connect(socket_of(UiHub(), heartbeat=0.02, timeout=0.15), hello())
    await page.next()
    page.say({"t": "ping"})
    seen = [await page.next() for _ in range(3)]
    assert {"t": "pong"} in seen
    page.leave()
    await served


async def test_a_page_too_slow_is_closed_to_resume() -> None:
    hub = UiHub(queue=3)
    page, served = await connect(socket_of(hub), hello(), reading=False)
    await asyncio.sleep(0.01)
    for index in range(10):
        hub.emit(note("s", f"op {index}"))
    await asyncio.wait_for(served, 2)
    assert page.closed and page.closed[0] == CLOSE_SLOW


class Rename(BaseModel):
    title: str


async def test_presses_are_answered_on_their_connection_with_the_registrys_status() -> None:
    hub = UiHub()
    registry = ActionRegistry(b"0123456789abcdef0123456789abcdef")
    renamed: list[tuple[Any, str]] = []

    async def rename(payload: Rename, context: Any) -> dict[str, str]:
        renamed.append((context.principal, payload.title))
        hub.emit(note(context.session, f"renamed {payload.title}"))
        return {"title": payload.title}

    registry.register("rename", Rename, rename, plugin="test")

    async def on_action(principal: Any, scope: str, action: UiAction) -> Any:
        return await registry.dispatch(principal, scope, action)

    socket = socket_of(hub, on_action=on_action)
    tab, served = await connect(socket, hello())
    other, served_other = await connect(socket, hello())
    await tab.next()
    await other.next()
    assert hub.connected("s") == 2
    offered = registry.offer("s", "card", "rename")
    tab.say(
        {
            "t": "action",
            "ref": "r1",
            "action": {
                "action": "rename",
                "display_id": "card",
                "token": offered.token,
                "payload": {"title": "Q3"},
                "idempotency_id": "press-1",
            },
        }
    )
    frames = [await tab.next(), await tab.next()]
    result = next(f for f in frames if f["t"] == "result")
    assert result == {
        "t": "result",
        "ref": "r1",
        "ok": True,
        "status": 200,
        "detail": None,
        "value": {"title": "Q3"},
    }
    # The other tab sees the op, not the result.
    assert (await other.next())["op"]["body"]["text"] == "renamed Q3"
    assert other.sent.empty()
    # The same press again: answered once, run once.
    tab.say(
        {
            "t": "action",
            "ref": "r2",
            "action": {
                "action": "rename",
                "display_id": "card",
                "token": offered.token,
                "payload": {"title": "Q3"},
                "idempotency_id": "press-1",
            },
        }
    )
    assert (await tab.next())["ok"] is True
    assert renamed == [("ada", "Q3")]
    # Not offered on that display: 403; nobody's action: 422; a bad payload: 422.
    for ref, action, status in (
        (
            "r3",
            {
                "action": "rename",
                "display_id": "other",
                "token": offered.token,
                "payload": {"title": "x"},
            },
            403,
        ),
        ("r4", {"action": "delete", "display_id": "card", "token": offered.token}, 422),
        (
            "r5",
            {
                "action": "rename",
                "display_id": "card",
                "token": offered.token,
                "payload": {},
            },
            422,
        ),
    ):
        tab.say({"t": "action", "ref": ref, "action": action})
        answered = await tab.next()
        assert (answered["ref"], answered["ok"], answered["status"]) == (
            ref,
            False,
            status,
        )
    # A state frame, with no state read here: 422.
    tab.say({"t": "state", "ref": "s1", "body": [{"op": "add", "path": "/a", "value": 1}]})
    assert (await tab.next())["status"] == 422
    tab.leave()
    other.leave()
    await served
    await served_other


async def test_a_handler_that_fails_is_answered_500_and_the_connection_stays() -> None:
    async def broken(principal: Any, scope: str, action: UiAction) -> Any:
        raise RuntimeError("boom")

    page, served = await connect(socket_of(UiHub(), on_action=broken), hello())
    await page.next()
    page.say(
        {
            "t": "action",
            "ref": "r",
            "action": {"action": "a", "display_id": "d", "token": "t"},
        }
    )
    answered = await page.next()
    assert (answered["ok"], answered["status"], answered["detail"]) == (
        False,
        500,
        "It failed.",
    )
    page.say({"t": "ping"})
    assert (await page.next()) == {"t": "pong"}
    page.leave()
    await served


async def test_state_frames_reach_the_host() -> None:
    told: list[Any] = []

    def on_state(principal: Any, scope: str, body: list[Any]) -> str:
        told.append((principal, scope, [op.model_dump(by_alias=True) for op in body]))
        return "kept"

    page, served = await connect(socket_of(UiHub(), on_state=on_state), hello())
    await page.next()
    page.say(
        {
            "t": "state",
            "ref": "s1",
            "body": [{"op": "replace", "path": "/tab", "value": "b"}],
        }
    )
    assert (await page.next())["value"] == "kept"
    assert told == [("ada", "s", [{"op": "replace", "path": "/tab", "value": "b"}])]
    page.leave()
    await served


def test_parse_up_refuses_what_is_not_an_up_frame() -> None:
    assert parse_up(json.dumps({"t": "ping"})).t == "ping"
    for text in ('{"t": "welcome", "scope": "s", "seq": 0}', '{"t": "op"}', "[]"):
        with pytest.raises(ValueError, match="not a reactor.ui frame"):
            parse_up(text)


def test_mounted_on_fastapi_it_serves_a_real_websocket() -> None:
    hub = UiHub()
    hub.emit(note("s", "before"))

    async def on_action(principal: Any, scope: str, action: UiAction) -> Any:
        hub.emit(note(scope, f"pressed {action.action}"))
        return "done"

    socket = socket_of(hub, on_action=on_action)
    app = FastAPI()
    app.add_api_websocket_route("/ui", socket.endpoint)
    with TestClient(app).websocket_connect("/ui", subprotocols=[UI_WS_PROTOCOL]) as ws:
        assert ws.accepted_subprotocol == UI_WS_PROTOCOL
        ws.send_text(json.dumps(hello()))
        assert ws.receive_json() == {"t": "welcome", "v": 1, "scope": "s", "seq": 1}
        assert ws.receive_json()["op"]["body"]["text"] == "before"
        ws.send_text(
            json.dumps(
                {
                    "t": "action",
                    "ref": "r",
                    "action": {"action": "go", "display_id": "d", "token": "t"},
                }
            )
        )
        frames = [ws.receive_json(), ws.receive_json()]
        assert {f["t"] for f in frames} == {"op", "result"}
        assert next(f for f in frames if f["t"] == "op")["seq"] == 2


# --- the committed example, held by both tiers ------------------------------------

EXAMPLES = Path(__file__).resolve().parent.parent / "schema" / "reactor-ui.v1.ws-examples.json"

CARD = {
    "type": "application/vnd.example.card+json",
    "version": 1,
    "id": "card-1",
    "text": "A card",
    "data": {"status": "open"},
    "actions": [],
}


async def _quiet(page: FakeSocket) -> list[dict[str, Any]]:
    """Every frame sent until the host goes quiet."""
    frames: list[dict[str, Any]] = []
    while True:
        try:
            frames.append(await asyncio.wait_for(page.sent.get(), 0.2))
        except asyncio.TimeoutError:
            return frames


async def _example() -> dict[str, Any]:
    """Two connections of one page: the first sees two ops and presses; the
    second resumes after the op the host emitted while it was away."""
    hub = UiHub()
    hub.emit({"v": 1, "op": "show", "scope": "s1", "id": "card-1", "body": CARD})
    hub.emit({"v": 1, "op": "meta", "scope": "s1", "body": {"title": "Q3"}})

    async def on_action(principal: Any, scope: str, action: UiAction) -> Any:
        hub.emit(
            {
                "v": 1,
                "op": "patch",
                "scope": scope,
                "id": action.display_id,
                "body": [{"op": "replace", "path": "/data/status", "value": "closed"}],
            }
        )
        return {"closed": action.display_id}

    socket = socket_of(hub, on_action=on_action)
    ups = [
        [
            hello("s1", since=None),
            {
                "t": "action",
                "ref": "id-2",
                "action": {
                    "action": "close",
                    "display_id": "card-1",
                    "token": "t0k",
                    "payload": {},
                    "idempotency_id": "id-1",
                },
            },
        ],
        [hello("s1", since=3)],
    ]
    connections = []
    for index, frames in enumerate(ups):
        if index == 1:
            hub.emit({"v": 1, "op": "remove", "scope": "s1", "id": "card-1"})
        page = FakeSocket()
        served = asyncio.create_task(socket.endpoint(page))
        steps: list[dict[str, Any]] = []
        for up in frames:
            page.say(up)
            steps.append({"up": up})
            steps.extend({"down": down} for down in await _quiet(page))
        page.leave()
        await served
        connections.append(steps)
    return {
        "description": "Two connections of one page to scope s1 over reactor.ui.ws: "
        "written by tests/test_ui_ws.py, replayed by src/ui/__tests__/ws.test.ts.",
        "connections": connections,
    }


async def test_the_committed_socket_example_is_what_the_host_says() -> None:
    example = await _example()
    if os.environ.get("WRITE_EXAMPLES"):
        EXAMPLES.write_text(json.dumps(example, indent=2) + "\n")
    assert example == json.loads(EXAMPLES.read_text())
    downs = [step["down"] for connection in example["connections"] for step in connection if "down" in step]
    assert [frame["t"] for frame in downs] == [
        "welcome",
        "op",
        "op",
        "op",
        "result",
        "welcome",
        "op",
    ]
    assert [frame["seq"] for frame in downs if frame["t"] == "op"] == [1, 2, 3, 4]
