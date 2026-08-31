# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Extensions that ship both tiers, and are discovered while the server runs.

The question these ask is the one issue #12 is really about: not "can a wheel
contain JavaScript", which is trivial, but "can a server that is already
serving notice that one was installed a moment ago". So the interesting test
writes a distribution onto ``sys.path`` *after* the app is up and asserts the
answer changes.
"""

from __future__ import annotations

import json
import sys
import textwrap
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from reactor import (
    EXTENSION_ENTRY_POINT_GROUP,
    ExtensionManifest,
    FrontendExtension,
    FrontendPlugin,
    PluginManifest,
    PluginPlatform,
    ReactorExtension,
    create_reactor_app,
)


def make_extension(tmp_path: Path, name: str = "hello") -> ReactorExtension:
    """An extension with both halves, its frontend on disk."""
    frontend = tmp_path / "share" / name
    frontend.mkdir(parents=True, exist_ok=True)
    (frontend / "index.js").write_text("export default { name: '@%s/panel' };" % name)
    (frontend / "secret.txt").write_text("not servable")

    return ReactorExtension(
        manifest=ExtensionManifest(name=name, display_name=name.title(), emoji="👋"),
        plugins=[(PluginManifest(name=name, version="1.0.0"), object())],
        frontend=FrontendExtension(
            directory=frontend,
            entry="index.js",
            plugins=[
                FrontendPlugin(
                    name=f"@{name}/panel",
                    display_name="Panel",
                    required_backend_plugins=[name],
                )
            ],
        ),
    )


def test_frontend_manifest_is_readable_without_the_module(tmp_path: Path) -> None:
    """The whole point: list and describe a plugin before fetching its code."""
    platform = PluginPlatform()
    extension = make_extension(tmp_path)
    platform._register_extension_object("hello", extension)  # noqa: SLF001

    [record] = platform.frontend_extensions()
    assert record["name"] == "hello"
    assert record["entry"] == "/reactor-extensions/hello/index.js"
    assert record["apiVersion"] == "v1"
    # The Python half it arrived with, so a host can draw them together.
    assert record["backendPlugins"] == ["hello"]

    [plugin] = record["plugins"]
    assert plugin["name"] == "@hello/panel"
    assert plugin["displayName"] == "Panel"
    assert plugin["requiredBackendPlugins"] == ["hello"]


def test_assets_are_served_and_traversal_is_refused(tmp_path: Path) -> None:
    platform = PluginPlatform()
    platform._register_extension_object("hello", make_extension(tmp_path))  # noqa: SLF001
    client = TestClient(create_reactor_app(platform))

    served = client.get("/reactor-extensions/hello/index.js")
    assert served.status_code == 200
    assert served.headers["content-type"].startswith("text/javascript")
    assert "@hello/panel" in served.text

    # Out of the directory, by any route.
    assert client.get("/reactor-extensions/hello/../../etc/passwd").status_code == 404
    assert client.get("/reactor-extensions/hello/%2e%2e/secret.txt").status_code == 404
    # Inside it, but not a type a browser should execute from an installed wheel.
    assert client.get("/reactor-extensions/hello/secret.txt").status_code == 404
    # An extension that does not exist reads the same as one that is refused.
    assert client.get("/reactor-extensions/nope/index.js").status_code == 404


def _write_distribution(root: Path, name: str) -> None:
    """Write a minimal installed distribution: a package and its metadata.

    A real ``pip install`` writes exactly this — an importable package and a
    ``.dist-info`` directory whose ``entry_points.txt`` advertises the group.
    Writing it by hand keeps the test hermetic and, more usefully, makes it
    obvious what discovery is actually reading.
    """
    package = root / f"{name}_extension"
    package.mkdir(parents=True)
    share = root / "share" / name
    share.mkdir(parents=True)
    (share / "index.js").write_text(f"export default {{ name: '@{name}/panel' }};")

    (package / "__init__.py").write_text(
        textwrap.dedent(
            f"""
            from pathlib import Path

            from reactor import (
                ExtensionManifest,
                FrontendExtension,
                FrontendPlugin,
                PluginManifest,
                ReactorExtension,
            )

            def extension() -> ReactorExtension:
                return ReactorExtension(
                    manifest=ExtensionManifest(name="{name}", display_name="{name.title()}"),
                    plugins=[(PluginManifest(name="{name}", version="1.0.0"), object())],
                    frontend=FrontendExtension(
                        directory=Path(__file__).resolve().parent.parent / "share" / "{name}",
                        plugins=[FrontendPlugin(name="@{name}/panel")],
                    ),
                )
            """
        )
    )

    dist_info = root / f"{name}_extension-0.1.0.dist-info"
    dist_info.mkdir()
    (dist_info / "METADATA").write_text(
        f"Metadata-Version: 2.1\nName: {name}-extension\nVersion: 0.1.0\n"
    )
    (dist_info / "entry_points.txt").write_text(
        f"[{EXTENSION_ENTRY_POINT_GROUP}]\n{name} = {name}_extension:extension\n"
    )


def test_installed_while_running_appears_on_the_next_request(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The requirement, as a test.

    The app is up and has already answered. A distribution appears on
    ``sys.path`` — which is what ``pip install`` does — and the *next* request
    sees it, with no restart.
    """
    site = tmp_path / "site-packages"
    site.mkdir()
    monkeypatch.syspath_prepend(str(site))

    platform = PluginPlatform()
    platform.start()
    client = TestClient(create_reactor_app(platform))

    assert client.get("/plugins/frontend-extensions").json() == []

    _write_distribution(site, "late")

    answer = client.get("/plugins/frontend-extensions").json()
    assert [record["name"] for record in answer] == ["late"]
    assert answer[0]["plugins"][0]["name"] == "@late/panel"

    # Both halves arrived: the Python plugin is registered and running too.
    assert any(plugin["name"] == "late" for plugin in client.get("/plugins").json())

    # And its asset is servable immediately, with no mount having been added.
    served = client.get(answer[0]["entry"])
    assert served.status_code == 200
    assert "@late/panel" in served.text


def test_rescan_is_idempotent_and_notices_removal(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    site = tmp_path / "site-packages"
    site.mkdir()
    monkeypatch.syspath_prepend(str(site))
    _write_distribution(site, "gone")

    platform = PluginPlatform()
    assert platform.rescan_extensions()["added"] == ["gone"]
    # Twice is not an error, and not a duplicate.
    assert platform.rescan_extensions() == {"added": [], "removed": []}
    assert len(platform.frontend_extensions()) == 1

    # Uninstalled: the metadata is what pip removes.
    for stale in (site / "gone_extension-0.1.0.dist-info").iterdir():
        stale.unlink()
    (site / "gone_extension-0.1.0.dist-info").rmdir()

    assert platform.rescan_extensions()["removed"] == ["gone"]
    assert platform.frontend_extensions() == []
    assert not any(p["name"] == "gone" for p in platform.list_plugins())


def test_a_broken_extension_is_one_missing_extension(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A malformed neighbour must not stop the host answering."""
    site = tmp_path / "site-packages"
    site.mkdir()
    monkeypatch.syspath_prepend(str(site))
    _write_distribution(site, "good")

    broken = site / "broken_extension-0.1.0.dist-info"
    broken.mkdir()
    (broken / "METADATA").write_text("Metadata-Version: 2.1\nName: broken\nVersion: 0.1\n")
    (broken / "entry_points.txt").write_text(
        f"[{EXTENSION_ENTRY_POINT_GROUP}]\nbroken = no_such_module:extension\n"
    )

    platform = PluginPlatform()
    assert platform.rescan_extensions()["added"] == ["good"]
    assert [record["name"] for record in platform.frontend_extensions()] == ["good"]


def test_revision_moves_only_when_something_changes(tmp_path: Path) -> None:
    """The number a browser follows, and the one polling is built on."""
    platform = PluginPlatform()
    platform.register_plugin(PluginManifest(name="a", version="1.0.0"), object())
    start = platform.revision

    platform.disable_plugin("a")
    after_disable = platform.revision
    assert after_disable > start

    # Disabling something already off is not a change.
    platform.disable_plugin("a")
    assert platform.revision == after_disable

    platform.enable_plugin("a")
    assert platform.revision > after_disable


def test_state_endpoint_answers_both_flags(tmp_path: Path) -> None:
    platform = PluginPlatform()
    platform.register_plugin(PluginManifest(name="a", version="1.0.0"), object())
    client = TestClient(create_reactor_app(platform))

    before = client.get("/plugins/state").json()
    assert before["plugins"] == [{"name": "a", "enabled": True, "activated": True}]

    client.post("/plugins/a/toggle", json={"enabled": False})
    after = client.get("/plugins/state").json()

    assert after["revision"] > before["revision"]
    assert after["plugins"][0]["enabled"] is False


def test_a_toggle_takes_dependants_with_it_over_http(tmp_path: Path) -> None:
    """The cascade, through the API the browser actually uses."""
    platform = PluginPlatform()
    platform.register_plugin(PluginManifest(name="base", version="1.0.0"), object())
    platform.register_plugin(
        PluginManifest(name="top", version="1.0.0", dependencies=["base"]), object()
    )
    client = TestClient(create_reactor_app(platform))

    client.post("/plugins/base/toggle", json={"enabled": False})
    plugins = {p["name"]: p for p in client.get("/plugins").json()}

    assert plugins["top"]["enabled"] is False
    assert plugins["top"]["disabled_by"] == "dependency"
    assert plugins["base"]["disabled_by"] == "user"


def test_the_event_stream_answers_and_says_what_changed() -> None:
    """The stream, exercised end to end.

    Worth a test of its own because the failure mode is invisible from Python:
    a signature FastAPI cannot resolve becomes a 422 at request time, and every
    other test in this file would still pass.
    """
    platform = PluginPlatform()
    platform.register_plugin(PluginManifest(name="a", version="1.0.0"), object())
    client = TestClient(create_reactor_app(platform))

    with client.stream(
        "GET", "/events/stream?poll_seconds=0.02&max_seconds=0.2"
    ) as response:
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")

        # The first frame is sent unconditionally, so a client is in step
        # before anything happens.
        frames = [
            json.loads(line[len("data: ") :])
            for line in response.iter_lines()
            if line.startswith("data: ")
        ]

    # The first frame is sent unconditionally, so a client is in step before
    # anything happens — and nothing changed, so there is exactly one.
    assert len(frames) == 1
    assert frames[0]["plugins"] == [{"name": "a", "enabled": True, "activated": True}]
