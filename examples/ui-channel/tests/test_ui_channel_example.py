# Copyright (c) 2026-Present Datalayer, Inc.
#
# BSD 3-Clause License

"""The approval card's round trip: display → wire → model view → token → dispatch."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from reactor.ui import (
    UiActionPayloadInvalid,
    UiActionRefused,
    UiActionTokenInvalid,
    UnknownUiAction,
    parse_op,
)
from ui_channel_example import DECIDE, AlreadyDecided, Approval, ApprovalDesk
from ui_channel_example.scripted import SECRET, SESSION, demo_desk, record
from ui_channel_example.server import create_app

FIXTURE = Path(__file__).resolve().parent.parent / "fixtures" / "demo-ops.json"


def laptop(**extra) -> Approval:
    return Approval(
        id="laptop",
        title="Laptop",
        amount_eur=1890,
        requester="ada",
        reviewer_note="Above the 1500 EUR team budget",
        vendor_key="vk-secret",
        **extra,
    )


def press_body(approval: Approval, **payload) -> dict:
    return {
        "action": DECIDE,
        "display_id": approval.id,
        "token": approval.actions[0].token,
        "payload": {"approve": True, **payload},
    }


def test_the_wire_carries_page_fields_and_never_the_secret() -> None:
    wire = laptop().wire()
    assert wire.type == "application/vnd.reactor-example.approval+json"
    assert wire.text == "Laptop: 1890.00 EUR for ada (pending)"
    assert wire.data["reviewer_note"] == "Above the 1500 EUR team budget"
    assert "vendor_key" not in wire.data
    assert "vk-secret" not in wire.model_dump_json()


def test_a_model_is_told_neither_page_fields_nor_the_secret() -> None:
    told = laptop().model_view()
    assert told["text"] == "Laptop: 1890.00 EUR for ada (pending)"
    assert set(told["data"]) == {"title", "amount_eur", "requester", "status"}


def test_the_display_comes_back_from_its_wire_form() -> None:
    desk = ApprovalDesk(SECRET)
    parsed = desk.platform.display_types().parse(laptop().wire().model_dump(mode="json"))
    assert isinstance(parsed, Approval)
    assert parsed.reviewer_note == "Above the 1500 EUR team budget"
    assert parsed.vendor_key is None


async def test_a_press_runs_once_and_the_page_hears_of_it() -> None:
    desk = ApprovalDesk(SECRET)
    approval = desk.request("s1", laptop())
    body = {
        **press_body(approval, comment="replaces the old one"),
        "idempotency_id": "p1",
    }
    assert await desk.press("grace", "s1", body) == {"status": "approved"}
    # A retry of the same press gets the first answer; the handler does not run again.
    assert await desk.press("grace", "s1", body) == {"status": "approved"}
    assert approval.history == ["approved by grace: replaces the old one"]
    assert [op["op"] for op in desk.ops("s1")] == [
        "meta",
        "show",
        "patch",
        "append",
        "state",
        "window",
    ]
    # The model learns the decision; the comment typed with it stays on the page.
    (told,) = desk.model_view("s1")["decisions"]
    assert told["decision"] == {"approve": True}
    assert "history" not in told["approval"]["data"]


async def test_only_an_offered_press_runs() -> None:
    desk = ApprovalDesk(SECRET)
    approval = desk.request("s1", laptop())
    with pytest.raises(UiActionTokenInvalid):
        await desk.press("grace", "s2", press_body(approval))
    with pytest.raises(UiActionTokenInvalid):
        await desk.press("grace", "s1", {**press_body(approval), "display_id": "train"})
    with pytest.raises(UnknownUiAction):
        await desk.press("grace", "s1", {**press_body(approval), "action": "approvals.delete"})
    with pytest.raises(UiActionPayloadInvalid):
        await desk.press("grace", "s1", {**press_body(approval), "payload": {"approve": "maybe"}})
    assert approval.status == "pending"


async def test_the_requester_cannot_decide_their_own_request() -> None:
    desk = ApprovalDesk(SECRET)
    approval = desk.request("s1", laptop())
    body = press_body(approval)
    with pytest.raises(UiActionRefused):
        await desk.press("ada", "s1", body)
    await desk.press("grace", "s1", body)
    # The offer is gone from the display, but the token still checks: the desk says it is late.
    with pytest.raises(AlreadyDecided):
        await desk.press("grace", "s1", {**body, "payload": {"approve": False}})


def test_the_recorded_session_is_what_the_desk_emits() -> None:
    """The TypeScript test replays this file: it must stay what the desk says."""
    import asyncio

    ops = asyncio.run(record(demo_desk()))
    assert json.loads(FIXTURE.read_text()) == ops
    for op in ops:
        parse_op(op)


def test_over_http_and_the_socket() -> None:
    client = TestClient(create_app(ApprovalDesk(SECRET)))
    shown = client.post(
        f"/sessions/{SESSION}/approvals",
        json={"title": "Laptop", "amount_eur": 1890, "requester": "ada"},
    ).json()
    press = {
        "action": DECIDE,
        "display_id": shown["id"],
        "token": shown["actions"][0]["token"],
        "payload": {"approve": False},
    }

    def say(ws, ref: str, action: dict) -> dict:
        ws.send_text(json.dumps({"t": "action", "ref": ref, "action": action}))
        while (frame := ws.receive_json())["t"] != "result":
            pass
        return frame

    # Somebody nobody knows is refused at the hello.
    with client.websocket_connect("/ui") as ws:
        ws.send_text(json.dumps({"t": "hello", "token": "mallory", "scope": SESSION}))
        with pytest.raises(Exception):
            ws.receive_json()

    with client.websocket_connect("/ui") as ada:
        ada.send_text(json.dumps({"t": "hello", "token": "ada", "scope": SESSION}))
        assert ada.receive_json() == {
            "t": "welcome",
            "v": 1,
            "scope": SESSION,
            "seq": 2,
        }
        assert [ada.receive_json()["op"]["op"] for _ in range(2)] == ["meta", "show"]
        refused = say(ada, "r1", press)
        assert (refused["ok"], refused["status"]) == (False, 403)
        forged = say(ada, "r2", {**press, "token": "forged"})
        assert forged["status"] == 403
        unknown = say(ada, "r3", {**press, "action": "approvals.nope"})
        assert unknown["status"] == 422

    with client.websocket_connect("/ui") as grace:
        grace.send_text(json.dumps({"t": "hello", "token": "grace", "scope": SESSION, "since": 2}))
        assert grace.receive_json()["seq"] == 2
        decided = say(grace, "r4", press)
        assert (decided["ok"], decided["value"]) == (True, {"status": "rejected"})
        late = say(grace, "r5", press)
        assert late["status"] == 409

    assert [op["op"] for op in client.app.state.desk.ops(SESSION)][2:] == [
        "patch",
        "append",
        "state",
        "window",
    ]
    assert "application/vnd.reactor-example.approval+json@1" in client.get("/display-types").json()
