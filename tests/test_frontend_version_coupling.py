# Copyright (c) 2026-Present Datalayer, Inc.
#
# BSD 3-Clause License

"""Both halves of an extension ship in one wheel, so they are one version.

A frontend built at another version than the Python half it shipped with is a
packaging bug — bumped and reinstalled, never rebuilt — and it is refused
rather than negotiated. Refused *visibly*: the extension stays listed, the
record the browser reads says why, and the log says it once at load.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from reactor import (
    FRONTEND_VERSION_FILE,
    ExtensionManifest,
    FrontendExtension,
    FrontendPlugin,
    PluginManifest,
    PluginPlatform,
    ReactorExtension,
    create_reactor_app,
)


def charts(tmp_path: Path, *, declared: str, built: str | None) -> ReactorExtension:
    """An extension whose Python half is ``declared`` and whose build says ``built``."""
    directory = tmp_path / "share" / "charts"
    directory.mkdir(parents=True, exist_ok=True)
    (directory / "remoteEntry.js").write_text("export function init() {}\n")
    if built is not None:
        (directory / FRONTEND_VERSION_FILE).write_text(
            json.dumps({"name": "charts-frontend", "version": built})
        )
    return ReactorExtension(
        manifest=ExtensionManifest(name="charts", version=declared),
        plugins=[(PluginManifest(name="charts", version=declared), object())],
        frontend=FrontendExtension(
            directory=directory,
            entry="remoteEntry.js",
            version=declared,
            kind="federated",
            remote_name="acme_charts",
            module="./plugin",
            plugins=[FrontendPlugin(name="@acme/charts", version=declared)],
        ),
    )


def test_one_version_on_both_sides_is_let_through(tmp_path: Path) -> None:
    platform = PluginPlatform()
    platform.register_extension_object(charts(tmp_path, declared="1.2.0", built="1.2.0"))

    [record] = platform.frontend_extensions()
    assert "refused" not in record


def test_a_frontend_built_at_another_version_is_refused_and_still_listed(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    platform = PluginPlatform()
    with caplog.at_level(logging.ERROR, logger="reactor.reactor"):
        platform.register_extension_object(charts(tmp_path, declared="1.3.0", built="1.2.0"))

    # Loud at load, for whoever installed it.
    [logged] = [r for r in caplog.records if r.levelno == logging.ERROR]
    assert "built at 1.2.0" in logged.getMessage()
    assert "is 1.3.0" in logged.getMessage()

    # Listed, with every plugin's manifest, and the reason on the record.
    [record] = platform.frontend_extensions()
    assert record["name"] == "charts"
    assert [plugin["name"] for plugin in record["plugins"]] == ["@acme/charts"]
    assert "packaging bug" in record["refused"]
    assert "built at 1.2.0" in record["refused"]

    # The Python half is the version pip installed, and it keeps running.
    assert platform.has_plugin("charts")


def test_a_build_that_records_no_version_is_refused(tmp_path: Path) -> None:
    platform = PluginPlatform()
    platform.register_extension_object(charts(tmp_path, declared="1.3.0", built=None))

    [record] = platform.frontend_extensions()
    assert "records no version" in record["refused"]


def test_versions_are_compared_as_written(tmp_path: Path) -> None:
    """``1.0`` is not ``1.0.0``: one wheel has no reason to spell it twice."""
    platform = PluginPlatform()
    platform.register_extension_object(charts(tmp_path, declared="1.0.0", built="1.0"))

    [record] = platform.frontend_extensions()
    assert "built at 1.0 " in record["refused"]


def test_rebuilding_in_place_lifts_the_refusal_on_the_next_request(tmp_path: Path) -> None:
    # A group of its own: the endpoint rescans before answering, and the
    # default group is whatever happens to be installed here.
    platform = PluginPlatform(extension_group="datalayer.reactor.test-version-coupling")
    extension = charts(tmp_path, declared="2.0.0", built="1.9.0")
    platform.register_extension_object(extension)
    client = TestClient(create_reactor_app(platform))

    [before] = client.get("/plugins/frontend-extensions").json()
    assert "refused" in before

    assert extension.frontend is not None
    (extension.frontend.directory / FRONTEND_VERSION_FILE).write_text(
        json.dumps({"version": "2.0.0"})
    )
    [after] = client.get("/plugins/frontend-extensions").json()
    assert "refused" not in after


def test_no_declared_version_claims_no_coupling(tmp_path: Path) -> None:
    """An extension that declares none has said nothing to check."""
    directory = tmp_path / "share" / "hello"
    directory.mkdir(parents=True)
    (directory / "index.js").write_text("export default {};")
    platform = PluginPlatform()
    platform.register_extension_object(
        ReactorExtension(
            manifest=ExtensionManifest(name="hello"),
            frontend=FrontendExtension(directory=directory),
        )
    )

    [record] = platform.frontend_extensions()
    assert "refused" not in record
