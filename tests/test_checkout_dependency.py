# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

from __future__ import annotations

import pytest

from reactor import PluginCompatibility, PluginManifest, PluginPlatform


class CatalogPlugin:
    def invoke_action(self, action: str, payload: dict | None = None, tenant_id: str | None = None) -> dict:
        if action != "list_songs":
            raise ValueError(f"Unsupported action {action}")
        return {
            "songs": [
                {"id": "s1", "title": "One", "artist": "A", "price": 1.0},
                {"id": "s2", "title": "Two", "artist": "B", "price": 2.0},
            ]
        }


class CheckoutPlugin:
    def __init__(self, reactor: PluginPlatform):
        self._reactor = reactor

    def invoke_action(self, action: str, payload: dict | None = None, tenant_id: str | None = None) -> dict:
        if action != "checkout":
            raise ValueError(f"Unsupported action {action}")

        data = payload or {}
        items = data.get("items", [])

        songs_payload = self._reactor.invoke_plugin_action(
            plugin_name="catalog",
            action="list_songs",
            payload=None,
            tenant_id=tenant_id,
        )
        catalog = {song["id"]: song for song in songs_payload.get("songs", [])}

        total = 0.0
        for item in items:
            song = catalog.get(item["id"])
            if song is None:
                raise ValueError(f"Unknown song '{item['id']}'")
            total += float(song["price"]) * int(item.get("quantity", 1))

        return {"status": "confirmed", "total": round(total, 2)}


CATALOG_MANIFEST = PluginManifest(
    name="catalog",
    version="1.0.0",
    compatibility=PluginCompatibility(api_version="v1"),
)

CHECKOUT_MANIFEST = PluginManifest(
    name="checkout",
    version="1.0.0",
    dependencies=["catalog"],
    compatibility=PluginCompatibility(api_version="v1"),
)


def test_checkout_requires_catalog_dependency() -> None:
    reactor = PluginPlatform()

    with pytest.raises(ValueError, match="missing dependencies: catalog"):
        reactor.register_plugin(CHECKOUT_MANIFEST, CheckoutPlugin(reactor))


def test_checkout_verifies_items_against_catalog_via_reactor() -> None:
    reactor = PluginPlatform()
    reactor.register_plugin(CATALOG_MANIFEST, CatalogPlugin())
    reactor.register_plugin(CHECKOUT_MANIFEST, CheckoutPlugin(reactor))

    result = reactor.invoke_plugin_action(
        plugin_name="checkout",
        action="checkout",
        payload={"items": [{"id": "s1", "quantity": 2}]},
    )

    assert result["status"] == "confirmed"
    assert result["total"] == 2.0

    with pytest.raises(ValueError, match="Unknown song 'missing'"):
        reactor.invoke_plugin_action(
            plugin_name="checkout",
            action="checkout",
            payload={"items": [{"id": "missing", "quantity": 1}]},
        )
