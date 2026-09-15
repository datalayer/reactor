"""Installable CMS host."""

from __future__ import annotations

import argparse
import os
from pathlib import Path

from fastapi import FastAPI
from reactor import PluginPlatform, create_reactor_host, run_reactor_host

from .api import router
from .store import Store


def create_app(*, database: str | Path | None = None, discover: bool = True) -> FastAPI:
    platform = PluginPlatform()
    app = create_reactor_host(platform, title="Reactor CMS for Astro", discover=discover)
    app.state.cms_store = Store(database or os.environ.get("CMS_ASTRO_DB", "cms-astro.sqlite3"))
    app.include_router(router)
    return app


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the Reactor CMS for Astro")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8791)
    parser.add_argument("--db", default=os.environ.get("CMS_ASTRO_DB", "cms-astro.sqlite3"))
    args = parser.parse_args()
    run_reactor_host(create_app(database=args.db), host=args.host, port=args.port)
