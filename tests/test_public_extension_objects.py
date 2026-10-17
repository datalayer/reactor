# Copyright (c) 2026-Present Datalayer, Inc.
#
# BSD 3-Clause License

"""Registering an extension object, mounting the routes plugins provide.

A host that holds an extension itself — built in its own process, composed by
an application — registers it with the public API and takes it away again; a
host that serves what plugins provide mounts their routes with endpoints.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from reactor import (
    EXTENSION_CONTENT_TYPES,
    ContributionPoint,
    ExtensionManifest,
    FrontendExtension,
    PluginManifest,
    PluginPlatform,
    ReactorExtension,
    create_reactor_app,
    include_plugin_routes,
)

GREETINGS: ContributionPoint[str] = ContributionPoint(id="test.greetings")


class Greeter:
    def provide_contributions(self, contributions) -> None:
        contributions.contribute(GREETINGS, "hello", contribution_id="hello")

    def provide_routes(self) -> list[dict]:
        def hello(name: str = "world") -> dict:
            return {"hello": name}

        return [
            {"path": "/hello", "method": "GET", "plugin": "greeter", "endpoint": hello},
            {"path": "/gateway-only", "method": "POST", "plugin": "greeter"},
        ]


def extension(tmp_path: Path, name: str = "greetings") -> ReactorExtension:
    directory = tmp_path / name
    directory.mkdir()
    (directory / "index.js").write_text("export default { name: 'greeter/page' };")
    return ReactorExtension(
        manifest=ExtensionManifest(name=name),
        plugins=[(PluginManifest(name="greeter", version="1.0.0"), Greeter())],
        frontend=FrontendExtension(directory=directory),
    )


def test_an_extension_object_is_registered_and_taken_away(tmp_path: Path) -> None:
    platform = PluginPlatform()
    assert platform.register_extension_object(extension(tmp_path)) == ["greeter"]
    assert platform.has_plugin("greeter")
    assert [c.value for c in platform.get_contributions(GREETINGS)] == ["hello"]
    [record] = platform.frontend_extensions()
    assert record["backendPlugins"] == ["greeter"]
    revision = platform.revision

    assert platform.unregister_extension("greetings") == ["greeter"]
    assert not platform.has_plugin("greeter")
    assert platform.get_contributions(GREETINGS) == []
    assert platform.frontend_extensions() == []
    assert platform.list_extensions() == []
    assert platform.revision > revision


def test_one_name_is_one_delivery(tmp_path: Path) -> None:
    platform = PluginPlatform()
    platform.register_extension_object(extension(tmp_path))
    with pytest.raises(ValueError, match="registered already"):
        platform.register_extension_object(
            ReactorExtension(manifest=ExtensionManifest(name="greetings"))
        )
    with pytest.raises(KeyError):
        platform.unregister_extension("nobody")


def test_the_content_types_are_the_ones_served(tmp_path: Path) -> None:
    platform = PluginPlatform()
    platform.register_extension_object(extension(tmp_path))
    served = TestClient(create_reactor_app(platform)).get(
        "/reactor-extensions/greetings/index.js"
    )
    assert served.headers["content-type"].startswith(EXTENSION_CONTENT_TYPES[".js"])
    assert ".txt" not in EXTENSION_CONTENT_TYPES


def test_routes_with_an_endpoint_are_mounted_and_described_without_it(
    tmp_path: Path,
) -> None:
    platform = PluginPlatform()
    platform.register_extension_object(extension(tmp_path))
    api = FastAPI()

    mounted = include_plugin_routes(api, platform, prefix="/plugins-of/")
    assert mounted == [{"path": "/hello", "method": "GET", "plugin": "greeter"}]
    client = TestClient(api)
    assert client.get("/plugins-of/hello", params={"name": "reactor"}).json() == {
        "hello": "reactor"
    }
    # The gateway's route is a declaration: not mounted here.
    assert client.post("/plugins-of/gateway-only").status_code == 404

    described = TestClient(create_reactor_app(platform)).get("/tenants/any/routes")
    assert described.status_code == 200
    assert all("endpoint" not in route for route in described.json())
    assert {route["path"] for route in described.json()} == {"/hello", "/gateway-only"}


def test_a_disabled_plugin_has_no_routes_mounted(tmp_path: Path) -> None:
    platform = PluginPlatform()
    platform.register_extension_object(extension(tmp_path))
    platform.disable_plugin("greeter")
    assert include_plugin_routes(FastAPI(), platform) == []


def test_the_hook_marker_is_public() -> None:
    from reactor import hookimpl
    from reactor.hooks import hookimpl as marker

    assert hookimpl is marker


def test_a_route_nobody_could_reach_is_refused() -> None:
    class Broken:
        def provide_routes(self) -> list[dict]:
            return [{"path": "hello", "method": "*", "plugin": "broken", "endpoint": lambda: 1}]

    platform = PluginPlatform()
    platform.register_plugin(PluginManifest(name="broken", version="1"), Broken())
    with pytest.raises(ValueError, match="does not start with '/'"):
        include_plugin_routes(FastAPI(), platform)
