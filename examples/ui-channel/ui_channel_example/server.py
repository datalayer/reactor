# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""The desk over HTTP and one WebSocket, for the page in ``src/``.

- ``WS /ui`` — the ui channel (``reactor.ui.ws``): the page says hello with
  its credential and a session, receives the session's ops numbered, and
  sends its presses up, each answered with the registry's status. Here the
  credential is the person's name, ``grace`` or ``ada``; a real host checks
  its own.
- ``POST /sessions/{session}/approvals`` — request an approval: a ``show`` op.
- ``GET /sessions/{session}/model`` — what a model is told about the session.
- ``GET /display-types`` — every display type's JSON Schema.

::

    uvicorn --app-dir examples/ui-channel ui_channel_example.server:app --port 8791
"""

from __future__ import annotations

import os
import secrets
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from reactor.ui import UiAction
from reactor.ui.ws import UiSocket

from .approval import Approval
from .desk import ApprovalDesk

#: Where the page's dev server runs.
PAGE_ORIGIN = "http://localhost:5181"

#: Who may connect: the credential is the name, in this example only.
PEOPLE = ("grace", "ada")


def authenticate(token: str, scope: str) -> str:
    if token not in PEOPLE:
        raise PermissionError(f"{token!r} is nobody here")
    return token


class ApprovalRequest(BaseModel):
    title: str
    amount_eur: float
    requester: str
    reviewer_note: str = ""


def create_app(desk: ApprovalDesk | None = None) -> FastAPI:
    secret = os.environ.get("UI_CHANNEL_EXAMPLE_SECRET", "").encode() or secrets.token_bytes(32)
    desk = desk or ApprovalDesk(secret)
    app = FastAPI(title="reactor.ui example")
    app.state.desk = desk
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[PAGE_ORIGIN],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    async def on_action(principal: str, session: str, action: UiAction) -> object:
        return await desk.press(principal, session, action)

    socket = UiSocket(desk.channel, authenticate=authenticate, on_action=on_action)
    app.add_api_websocket_route("/ui", socket.endpoint)

    @app.post("/sessions/{session}/approvals")
    def request_approval(session: str, body: ApprovalRequest) -> dict[str, Any]:
        approval = desk.request(session, Approval(**body.model_dump()))
        return approval.wire().model_dump(mode="json")

    @app.get("/sessions/{session}/model")
    def model(session: str) -> dict[str, Any]:
        return desk.model_view(session)

    @app.get("/display-types")
    def display_types() -> dict[str, Any]:
        return desk.platform.display_types().schemas()

    return app


app = create_app()
