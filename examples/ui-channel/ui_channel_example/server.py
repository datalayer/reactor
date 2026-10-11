# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""The desk over HTTP, for the page in ``src/``.

- ``POST /sessions/{session}/approvals`` — request an approval: a ``show`` op.
- ``GET /sessions/{session}/ops?after=n`` — the ops from the n-th on. The page
  polls; a host on a websocket or an AG-UI stream sends the same ops.
- ``POST /sessions/{session}/actions`` — a press. ``X-Principal`` says who
  pressed (a real host takes it from its own authentication).
- ``GET /sessions/{session}/model`` — what a model is told about the session.
- ``GET /display-types`` — every display type's JSON Schema.

The reactor ships no route for actions: the host maps ``UiActionError`` to
its ``status_code`` in its own exception handler, as here.

::

    uvicorn --app-dir examples/ui-channel ui_channel_example.server:app --port 8791
"""

from __future__ import annotations

import os
import secrets
from typing import Any

from fastapi import FastAPI, Header, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from reactor.ui import UiActionError

from .approval import Approval
from .desk import ApprovalDesk

#: Where the page's dev server runs.
PAGE_ORIGIN = "http://localhost:5181"


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

    @app.exception_handler(UiActionError)
    async def refused(_: Request, error: UiActionError) -> JSONResponse:
        return JSONResponse(
            status_code=error.status_code,
            content={"error": type(error).__name__, "detail": str(error)},
        )

    @app.post("/sessions/{session}/approvals")
    def request_approval(session: str, body: ApprovalRequest) -> dict[str, Any]:
        approval = desk.request(session, Approval(**body.model_dump()))
        return approval.wire().model_dump(mode="json")

    @app.get("/sessions/{session}/ops")
    def ops(session: str, after: int = 0) -> dict[str, Any]:
        everything = desk.ops(session)
        return {"ops": everything[after:], "next": len(everything)}

    @app.post("/sessions/{session}/actions")
    async def press(
        session: str, body: dict[str, Any], x_principal: str = Header(default="grace")
    ) -> Any:
        return await desk.press(x_principal, session, body)

    @app.get("/sessions/{session}/model")
    def model(session: str) -> dict[str, Any]:
        return desk.model_view(session)

    @app.get("/display-types")
    def display_types() -> dict[str, Any]:
        return desk.platform.display_types().schemas()

    return app


app = create_app()
