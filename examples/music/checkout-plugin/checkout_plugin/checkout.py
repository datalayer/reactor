# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Checkout plugin backend.

A reactor plugin that turns a cart into a confirmed order. It depends on the
catalog plugin in two ways:

* **Python package dependency** — it imports `catalog_plugin` to read the
  authoritative song catalog (ids, titles, prices), and
* **reactor dependency** — its `PluginManifest` declares
  ``dependencies=["catalog"]``, so the reactor `PluginPlatform` refuses to
  register the checkout plugin unless the catalog plugin is registered first.

Run standalone with (serves catalog + checkout on the same app):

    uvicorn checkout_plugin.app:app --reload --port 8799
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, FastAPI, HTTPException
from pydantic import BaseModel

from catalog_plugin import (
    catalog_router,
    register as register_catalog,
)
from reactor import (
    PluginCompatibility,
    PluginManifest,
    PluginPlatform,
    create_reactor_app,
)
from reactor.hooks import hookimpl


class CheckoutItem(BaseModel):
    id: str
    quantity: int = 1


class CheckoutRequest(BaseModel):
    items: list[CheckoutItem]


# Reactor manifest for the checkout plugin. The `dependencies=["catalog"]` entry
# is the reactor dependency on the catalog plugin — the reactor enforces that
# the catalog plugin is registered first.
CHECKOUT_MANIFEST = PluginManifest(
    name="checkout",
    version="1.0.0",
    display_name="Checkout",
    description="Prices a cart against the catalog and turns it into an order.",
    octicon="credit-card",
    emoji="💳",
    dependencies=["catalog"],
    # Required, because the endpoint this plugin serves is only ever called by
    # the checkout UI: a backend without it is reachable but unused.
    frontend_dependencies=["@music/checkout"],
    compatibility=PluginCompatibility(api_version="v1"),
)


class CheckoutPlugin:
    """Reactor plugin that prices a cart against the catalog and confirms orders."""

    def __init__(self, reactor: PluginPlatform):
        self._reactor = reactor

    @hookimpl
    def on_reactor_start(self, tenant_id: str | None = None) -> None:
        print(f"[CheckoutPlugin] started tenant={tenant_id}")

    @hookimpl
    def on_reactor_stop(self, tenant_id: str | None = None) -> None:
        print(f"[CheckoutPlugin] stopped tenant={tenant_id}")

    def provide_routes(self) -> list[dict]:
        return [{"path": "/api/checkout", "method": "POST", "plugin": "checkout"}]

    def invoke_action(
        self,
        action: str,
        payload: dict | None = None,
        tenant_id: str | None = None,
    ) -> dict:
        if action != "checkout":
            raise ValueError(f"Unsupported action '{action}' for checkout plugin")

        data = payload or {}
        items = data.get("items", [])

        # Resolve the catalog through Reactor so the checkout flow depends on the
        # registered catalog plugin contract (not a direct in-process call).
        catalog_payload = self._reactor.invoke_plugin_action(
            plugin_name="catalog",
            action="list_songs",
            payload=None,
            tenant_id=tenant_id,
        )
        songs = catalog_payload.get("songs", [])
        catalog = {song["id"]: song for song in songs}

        lines: list[dict] = []
        item_count = 0
        total = 0.0
        for item in items:
            song = catalog.get(item.get("id"))
            if song is None:
                raise ValueError(f"Unknown song '{item.get('id')}'")
            quantity = int(item.get("quantity", 1))
            if quantity < 1:
                raise ValueError(f"Invalid quantity for song '{song['id']}'")
            line_total = round(float(song["price"]) * quantity, 2)
            item_count += quantity
            total += line_total
            lines.append(
                {
                    "id": song["id"],
                    "title": song["title"],
                    "artist": song["artist"],
                    "price": song["price"],
                    "quantity": quantity,
                    "lineTotal": line_total,
                }
            )

        return {
            "orderId": uuid.uuid4().hex,
            "status": "confirmed",
            "lines": lines,
            "itemCount": item_count,
            "total": round(total, 2),
        }


def register(reactor: PluginPlatform) -> None:
    """Register the checkout plugin on an existing reactor reactor.

    The catalog plugin must already be registered — the reactor enforces the
    ``dependencies=["catalog"]`` declared in ``CHECKOUT_MANIFEST``.
    """
    reactor.register_plugin(CHECKOUT_MANIFEST, CheckoutPlugin(reactor))


def build_checkout_router(reactor: PluginPlatform) -> APIRouter:
    """Build the real HTTP router that delegates to the checkout plugin."""
    router = APIRouter()

    @router.post("/api/checkout")
    def checkout(request: CheckoutRequest) -> dict:
        try:
            return reactor.invoke_plugin_action(
                plugin_name="checkout",
                action="checkout",
                payload=request.model_dump(),
            )
        except (KeyError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    return router


def create_app() -> FastAPI:
    """Build a standalone FastAPI app serving both catalog and checkout.

    Registers the catalog plugin first, then the checkout plugin (which declares a
    reactor dependency on it), starts the reactor, and mounts both the catalog
    and checkout REST endpoints on top of the reactor management routes.
    """
    reactor = PluginPlatform()
    register_catalog(reactor)  # registers "catalog"
    register(reactor)  # registers "checkout" (depends on "catalog")
    reactor.start()
    app = create_reactor_app(reactor)
    app.include_router(catalog_router)
    app.include_router(build_checkout_router(reactor))
    return app
