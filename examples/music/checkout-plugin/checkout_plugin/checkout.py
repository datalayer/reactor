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
    list_songs,
    register as register_catalog,
)
from datalayer_reactor import (
    PluginCompatibility,
    PluginManifest,
    PluginPlatform,
    create_platform_app,
)
from datalayer_reactor.hooks import hookimpl


class CheckoutItem(BaseModel):
    id: str
    quantity: int = 1


class CheckoutRequest(BaseModel):
    items: list[CheckoutItem]


# Reactor manifest for the checkout plugin. The `dependencies=["catalog"]` entry
# is the reactor dependency on the catalog plugin — the platform enforces that
# the catalog plugin is registered first.
CHECKOUT_MANIFEST = PluginManifest(
    name="checkout",
    version="1.0.0",
    description="Checkout backend that turns a cart into an order",
    dependencies=["catalog"],
    compatibility=PluginCompatibility(api_version="v1"),
)


class CheckoutPlugin:
    """Reactor plugin that prices a cart against the catalog and confirms orders."""

    @hookimpl
    def on_platform_start(self, tenant_id: str | None = None) -> None:
        print(f"[CheckoutPlugin] started tenant={tenant_id}")

    @hookimpl
    def on_platform_stop(self, tenant_id: str | None = None) -> None:
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

        # Reactor dependency at work: price the cart against the catalog owned by
        # the catalog plugin.
        catalog = {song.id: song for song in list_songs()}

        lines: list[dict] = []
        item_count = 0
        total = 0.0
        for item in items:
            song = catalog.get(item.get("id"))
            if song is None:
                raise ValueError(f"Unknown song '{item.get('id')}'")
            quantity = int(item.get("quantity", 1))
            if quantity < 1:
                raise ValueError(f"Invalid quantity for song '{song.id}'")
            line_total = round(song.price * quantity, 2)
            item_count += quantity
            total += line_total
            lines.append(
                {
                    "id": song.id,
                    "title": song.title,
                    "artist": song.artist,
                    "price": song.price,
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


def register(platform: PluginPlatform) -> None:
    """Register the checkout plugin on an existing reactor platform.

    The catalog plugin must already be registered — the platform enforces the
    ``dependencies=["catalog"]`` declared in ``CHECKOUT_MANIFEST``.
    """
    platform.register_plugin(CHECKOUT_MANIFEST, CheckoutPlugin())


def build_checkout_router(platform: PluginPlatform) -> APIRouter:
    """Build the real HTTP router that delegates to the checkout plugin."""
    router = APIRouter()

    @router.post("/api/checkout")
    def checkout(request: CheckoutRequest) -> dict:
        try:
            return platform.invoke_plugin_action(
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
    reactor dependency on it), starts the platform, and mounts both the catalog
    and checkout REST endpoints on top of the reactor management routes.
    """
    platform = PluginPlatform()
    register_catalog(platform)  # registers "catalog"
    register(platform)  # registers "checkout" (depends on "catalog")
    platform.start()
    app = create_platform_app(platform)
    app.include_router(catalog_router)
    app.include_router(build_checkout_router(platform))
    return app
