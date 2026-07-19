# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Catalog plugin backend.

A reactor plugin that owns the song catalog consumed by the music frontend
plugins (catalog, header, shop). It exposes both:

* a real REST endpoint (`GET /api/catalog/songs`) served via a FastAPI router,
  and
* a reactor plugin (`CatalogPlugin`) registered on a `PluginPlatform`, so other
  backends (such as the checkout plugin) can declare a reactor dependency on it.

Run standalone with:

    uvicorn catalog_plugin.app:app --reload --port 8799
"""

from __future__ import annotations

from fastapi import APIRouter, FastAPI
from pydantic import BaseModel

from datalayer_reactor import (
    PluginCompatibility,
    PluginManifest,
    PluginPlatform,
    create_reactor_app,
)
from datalayer_reactor.hooks import hookimpl


class Song(BaseModel):
    id: str
    title: str
    artist: str
    price: float


SONGS: list[Song] = [
    Song(id="s1", title="Quantum Sunrise", artist="Nova Fields", price=1.29),
    Song(id="s2", title="Neon Harbor", artist="The Lumen", price=0.99),
    Song(id="s3", title="Gravity Waltz", artist="Ada Cole", price=1.49),
    Song(id="s4", title="Paper Satellites", artist="Kite Museum", price=1.09),
    Song(id="s5", title="Midnight Kernel", artist="Root Access", price=1.19),
    Song(id="s6", title="Analog Dreams", artist="Vela Bloom", price=0.89),
]


def list_songs() -> list[Song]:
    """Return the full song catalog."""
    return SONGS


# Reactor manifest for the catalog plugin. The `name` ("catalog") is what other
# plugins reference in their `dependencies` list.
CATALOG_MANIFEST = PluginManifest(
    name="catalog",
    version="1.0.0",
    description="Song catalog backend",
    compatibility=PluginCompatibility(api_version="v1"),
)


class CatalogPlugin:
    """Reactor plugin exposing the song catalog."""

    @hookimpl
    def on_reactor_start(self, tenant_id: str | None = None) -> None:
        print(f"[CatalogPlugin] started tenant={tenant_id}")

    @hookimpl
    def on_reactor_stop(self, tenant_id: str | None = None) -> None:
        print(f"[CatalogPlugin] stopped tenant={tenant_id}")

    def provide_routes(self) -> list[dict]:
        return [{"path": "/api/catalog/songs", "method": "GET", "plugin": "catalog"}]

    def invoke_action(
        self,
        action: str,
        payload: dict | None = None,
        tenant_id: str | None = None,
    ) -> dict:
        if action != "list_songs":
            raise ValueError(f"Unsupported action '{action}' for catalog plugin")
        return {"songs": [song.model_dump() for song in list_songs()]}


# Real HTTP router serving the catalog data to the frontend.
catalog_router = APIRouter()


@catalog_router.get("/api/catalog/songs", response_model=list[Song])
def get_songs() -> list[Song]:
    return list_songs()


def register(reactor: PluginPlatform) -> None:
    """Register the catalog plugin on an existing reactor reactor."""
    reactor.register_plugin(CATALOG_MANIFEST, CatalogPlugin())


def create_app() -> FastAPI:
    """Build a standalone FastAPI app for the catalog backend.

    Registers the catalog plugin on a reactor reactor, starts it, and mounts the
    real catalog REST endpoint on top of the reactor management routes.
    """
    reactor = PluginPlatform()
    register(reactor)
    reactor.start()
    app = create_reactor_app(reactor)
    app.include_router(catalog_router)
    return app
