# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""A host: one application serving a platform *and* its interface.

The questions worth asking are the ones that separate a host from a static file
server — does an API path still win, does a client-side route survive a refresh,
and does a UI directory stop being a way to read the filesystem.
"""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi import APIRouter
from fastapi.testclient import TestClient

from reactor import (
    PluginManifest,
    PluginPlatform,
    create_reactor_host,
    find_ui,
    mount_reactor_ui,
)


def build_ui(tmp_path: Path) -> Path:
    ui = tmp_path / "ui"
    (ui / "static").mkdir(parents=True)
    (ui / "index.html").write_text("<!doctype html><title>Store</title>")
    (ui / "static" / "app.js").write_text("console.log('app')")
    (tmp_path / "secret.txt").write_text("not yours")
    return ui


def host(tmp_path: Path) -> TestClient:
    """A host shaped like a real one: a platform, a plugin router, then the UI."""
    platform = PluginPlatform(extension_group="nothing.installed.here")
    platform.register_plugin(PluginManifest(name="catalog", version="1.0.0"), object())
    app = create_reactor_host(platform, ui=build_ui(tmp_path), title="Store")

    # A plugin's own routes, mounted before the UI — which is the order that
    # makes the reserved-prefix logic below mean anything.
    router = APIRouter()

    @router.get("/api/catalog/songs")
    def songs() -> list[dict]:
        return [{"id": "s1", "title": "Quantum Sunrise"}]

    app.include_router(router)

    mount_reactor_ui(app)
    return TestClient(app)


def test_serves_the_interface_and_the_api_from_one_origin(tmp_path: Path) -> None:
    client = host(tmp_path)

    index = client.get("/")
    assert index.status_code == 200
    assert "Store" in index.text

    assert client.get("/static/app.js").status_code == 200

    # The whole point: no second address. The API is still the API.
    assert [p["name"] for p in client.get("/plugins").json()] == ["catalog"]
    assert client.get("/plugins/state").json()["plugins"][0]["name"] == "catalog"
    # And a plugin's own route, which is the half a static server cannot give.
    assert client.get("/api/catalog/songs").json()[0]["title"] == "Quantum Sunrise"


def test_a_client_side_route_survives_a_refresh(tmp_path: Path) -> None:
    """A path this server has never heard of is the application's, not a 404."""
    answer = host(tmp_path).get("/graph")
    assert answer.status_code == 200
    assert "Store" in answer.text


def test_an_api_path_is_never_answered_with_html(tmp_path: Path) -> None:
    """The failure this route ordering exists to prevent.

    The UI's catch-all is registered last, so an unknown path *under* an API
    prefix still reaches the API and gets its answer — a 404 as JSON, not the
    application as HTML, which a client would try to parse and fail on.
    """
    client = host(tmp_path)
    for path in ("/plugins/nope/toggle", "/plugins/typo", "/api/catalog/nothing"):
        answer = client.get(path)
        assert "text/html" not in answer.headers.get("content-type", ""), path
        assert answer.status_code == 404, path

    # And a route that is genuinely the application's still gets it.
    assert "Store" in client.get("/graph").text


def test_the_ui_directory_is_not_a_window_on_the_filesystem(tmp_path: Path) -> None:
    client = host(tmp_path)
    for attempt in ("/../secret.txt", "/%2e%2e/secret.txt", "/static/../../secret.txt"):
        answer = client.get(attempt)
        assert "not yours" not in answer.text


def test_a_host_without_a_ui_is_still_a_host(tmp_path: Path) -> None:
    """A backend-for-frontend has no browser, and should not have to pretend."""
    app = create_reactor_host(PluginPlatform())
    assert mount_reactor_ui(app) is False
    assert TestClient(app).get("/plugins").status_code == 200


def test_a_missing_build_is_reported_rather_than_served(tmp_path: Path) -> None:
    """`npm run build` not having been run is a state, not a crash."""
    app = create_reactor_host(PluginPlatform(), ui=tmp_path / "never-built")
    assert mount_reactor_ui(app) is False
    assert TestClient(app).get("/plugins").status_code == 200


def test_find_ui_looks_where_a_wheel_puts_it(tmp_path: Path) -> None:
    package = tmp_path / "site-packages" / "my_app"
    package.mkdir(parents=True)
    (package / "__init__.py").write_text("")

    assert find_ui(package / "__init__.py", "music") is None

    shipped = tmp_path / "site-packages" / "share/datalayer/reactor/apps/music"
    shipped.mkdir(parents=True)
    (shipped / "index.html").write_text("<!doctype html>")

    assert find_ui(package / "__init__.py", "music") == shipped.resolve()


def test_discovery_on_boot_beats_waiting_for_a_browser(tmp_path: Path) -> None:
    """`discover=True` means an installed extension is there from request one."""
    # The group is set on the platform, not just passed to `discover`: the
    # frontend-extensions endpoint rescans on its own, and it asks the platform
    # which group to scan. Overriding only one of the two would leave the
    # endpoint reading whatever is installed in the environment.
    platform = PluginPlatform(extension_group="nothing.installed.here")
    app = create_reactor_host(platform, discover=True)
    # An empty group is not an error — a host with no extensions still serves.
    assert TestClient(app).get("/plugins/frontend-extensions").json() == []


def test_the_base_server_names_no_plugin() -> None:
    """`reactor` on the command line: a host with nothing compiled into it.

    Worth its own test because it is the claim the whole project makes. A host
    that registered plugins by name could always be accused of knowing about
    them; this one has a platform, the API, and a scan.
    """
    from reactor import create_base_app

    app = create_base_app(with_ui=False)
    client = TestClient(app)

    assert client.get("/healthz").json() == {"status": "ok"}
    # It serves the management API whether or not anything is installed.
    assert client.get("/plugins").status_code == 200
    assert client.get("/plugins/frontend-extensions").status_code == 200
    # No interface was pointed at, so `/` is not the application's.
    assert client.get("/").status_code == 404


def test_the_base_server_serves_a_ui_when_pointed_at_one(tmp_path: Path) -> None:
    from reactor import create_base_app

    ui = build_ui(tmp_path)
    client = TestClient(create_base_app(ui=ui))
    assert "Store" in client.get("/").text
    # And still answers the API, which is the ordering that matters.
    assert client.get("/plugins").status_code == 200


def test_find_share_looks_where_a_wheel_puts_it_and_where_a_checkout_does(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Both, because they are different places and both have to work.

    An installed wheel puts `share/` under `sys.prefix`, nowhere near the
    package — data files and Python packages are separate destinations. A
    checkout leaves it beside the package. Looking only beside the package is
    the bug you get away with until somebody installs the wheel for real.
    """
    import sys

    from reactor import find_share

    # A checkout: `share/` beside the package.
    checkout = tmp_path / "repo"
    package = checkout / "my_ext"
    package.mkdir(parents=True)
    beside = checkout / "share/datalayer/reactor/extensions/mine"
    beside.mkdir(parents=True)
    assert find_share(package / "__init__.py", "extensions/mine") == beside.resolve()

    # A wheel: nothing beside the package, everything under `sys.prefix`.
    installed = tmp_path / "prefix"
    site = installed / "lib/site-packages/my_ext"
    site.mkdir(parents=True)
    shipped = installed / "share/datalayer/reactor/extensions/mine"
    shipped.mkdir(parents=True)
    monkeypatch.setattr(sys, "prefix", str(installed))
    assert find_share(site / "__init__.py", "extensions/mine") == shipped.resolve()

    # Neither: an extension with no frontend, which is a legitimate thing to be.
    assert find_share(site / "__init__.py", "extensions/absent") is None
