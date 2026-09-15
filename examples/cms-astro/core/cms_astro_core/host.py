# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Installable CMS host."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import JSONResponse
from reactor import PluginPlatform, create_reactor_host, run_reactor_host

from .api import router
from .store import Store


def create_app(*, database: str | Path | None = None, discover: bool = True, allow_identity_header: bool = False) -> FastAPI:
    platform = PluginPlatform()
    app = create_reactor_host(platform, title="Reactor CMS for Astro", discover=discover)
    app.state.cms_store = Store(database or os.environ.get("CMS_ASTRO_DB", "cms-astro.sqlite3"))
    app.state.cms_allow_identity_header = allow_identity_header

    @app.middleware("http")
    async def cms_authentication(request, call_next):
        # An authenticated cross-origin request first sends an unauthenticated
        # OPTIONS preflight. Let Reactor's CORS middleware answer it; otherwise
        # the browser reports a generic "Failed to fetch" and never sends the
        # request carrying the bearer token.
        if (
            request.method != "OPTIONS"
            and request.url.path.startswith("/api/cms")
            and not request.url.path.startswith("/api/cms/auth/")
        ):
            user_id = None
            authorization = request.headers.get("authorization", "")
            if authorization.lower().startswith("bearer "):
                user_id = app.state.cms_store.session_user(authorization[7:].strip())
                if not user_id:
                    return JSONResponse({"detail": "invalid or expired session"}, status_code=401)
            elif allow_identity_header:
                user_id = request.headers.get("x-cms-user")
            if not user_id:
                return JSONResponse({"detail": "authentication required"}, status_code=401)
            headers = list(request.scope["headers"])
            headers = [(key, value) for key, value in headers if key.lower() != b"x-cms-user"]
            headers.append((b"x-cms-user", user_id.encode()))
            request.scope["headers"] = headers
        return await call_next(request)

    app.include_router(router)
    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the Reactor CMS for Astro")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8791)
    parser.add_argument("--db", default=os.environ.get("CMS_ASTRO_DB", "cms-astro.sqlite3"))
    args = parser.parse_args()
    run_reactor_host(create_app(database=args.db), host=args.host, port=args.port)
