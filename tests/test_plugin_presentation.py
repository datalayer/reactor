# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Presentation metadata and cross-tier declarations."""

from __future__ import annotations

import pytest

from reactor import PluginManifest, PluginPlatform, create_reactor_app


def manifest(name: str, **fields) -> PluginManifest:
    return PluginManifest(name=name, version="1.0.0", **fields)


def test_title_falls_back_to_the_identifier() -> None:
    """A host always has something to print."""
    assert manifest("catalog").title == "catalog"
    assert manifest("catalog", display_name="Catalog").title == "Catalog"


def test_presentation_travels_with_the_manifest() -> None:
    platform = PluginPlatform()
    platform.register_plugin(
        manifest("catalog", display_name="Catalog", octicon="book", emoji="🎵"),
        object(),
    )

    listed = platform.list_plugins()[0]

    assert listed["display_name"] == "Catalog"
    assert listed["octicon"] == "book"
    assert listed["emoji"] == "🎵"


def test_frontend_requirements_report_what_is_missing() -> None:
    platform = PluginPlatform()
    platform.register_plugin(
        manifest(
            "checkout",
            frontend_dependencies=["@music/checkout"],
            optional_frontend_dependencies=["@music/header"],
        ),
        object(),
    )

    nothing_loaded = platform.frontend_requirements([])
    assert nothing_loaded["checkout"]["missing_required"] == ["@music/checkout"]
    assert nothing_loaded["checkout"]["missing_optional"] == ["@music/header"]

    everything = platform.frontend_requirements(["@music/checkout", "@music/header"])
    assert everything["checkout"]["missing_required"] == []
    assert everything["checkout"]["missing_optional"] == []


def test_a_plugin_asking_nothing_of_the_frontend_is_not_reported() -> None:
    """The report is about relationships, so a plugin without one is absent."""
    platform = PluginPlatform()
    platform.register_plugin(manifest("catalog"), object())

    assert platform.frontend_requirements(["@music/anything"]) == {}


def test_a_disabled_plugin_asks_for_nothing() -> None:
    platform = PluginPlatform()
    platform.register_plugin(
        manifest("checkout", frontend_dependencies=["@music/checkout"]), object()
    )
    platform.disable_plugin("checkout")

    assert platform.frontend_requirements([]) == {}


def test_frontend_declarations_do_not_block_registration() -> None:
    """The platform cannot see a browser, so it must not refuse over one.

    Backend `dependencies` are enforced; frontend ones are declared and
    answered by whoever can see both sides.
    """
    platform = PluginPlatform()
    platform.register_plugin(
        manifest("checkout", frontend_dependencies=["@music/never-loaded"]), object()
    )

    assert [p["name"] for p in platform.list_plugins()] == ["checkout"]

    with pytest.raises(ValueError):
        # A *backend* dependency, by contrast, is refused outright.
        platform.register_plugin(manifest("orphan", dependencies=["absent"]), object())


def test_requirements_are_served_over_the_management_api() -> None:
    from fastapi.testclient import TestClient

    platform = PluginPlatform()
    platform.register_plugin(
        manifest("checkout", frontend_dependencies=["@music/checkout"]), object()
    )
    client = TestClient(create_reactor_app(platform))

    missing = client.get("/plugins/frontend-requirements").json()
    assert missing["checkout"]["missing_required"] == ["@music/checkout"]

    satisfied = client.get(
        "/plugins/frontend-requirements", params={"active": "@music/checkout"}
    ).json()
    assert satisfied["checkout"]["missing_required"] == []
