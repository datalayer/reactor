# Copyright (c) 2026-Present Datalayer, Inc.
#
# BSD 3-Clause License

"""``examples/extension-template`` still makes an extension that works.

A template is read by nobody in this repository and run by somebody outside
it, so it rots silently: an option renamed upstream, a field that moved, an
entry file the bundler stopped emitting under that name. These tests do what
its README tells a newcomer to do — generate, build, ``pip install``, serve —
with one substitution: the frontend build (``npm run build``) is replaced by
the two files the checks below hold its configuration to emitting, so the
suite needs no Node.

The wheel is built by the template's own ``pyproject.toml`` and installed by
pip into a prefix of its own, so packaging is tested as it ships — entry point,
``share/`` data, the version read from ``frontend/package.json``.
"""

from __future__ import annotations

import importlib
import json
import re
import subprocess
import sys
import sysconfig
from importlib.metadata import distributions
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from reactor import (
    EXTENSION_ENTRY_POINT_GROUP,
    FRONTEND_VERSION_FILE,
    PluginPlatform,
    ReactorExtension,
    create_reactor_app,
)

TEMPLATE = Path(__file__).resolve().parents[1] / "examples" / "extension-template"

#: A group nothing is installed under, so the endpoint's rescan adds nothing
#: from the environment running the suite.
QUIET_GROUP = "datalayer.reactor.test-extension-template"


def generate(target: Path, name: str) -> Path:
    """Run the template's generator, as its README says to."""
    subprocess.run(
        [sys.executable, str(TEMPLATE / "new-extension.py"), name, str(target)],
        check=True,
        capture_output=True,
        text=True,
    )
    return target


def fake_build(project: Path, name: str) -> Path:
    """What ``npm run build`` leaves in ``share/``, as far as the host reads it.

    ``test_the_two_halves_name_each_other_alike`` holds the Rsbuild config to
    emitting exactly these two: the container entry, and the ``package.json``
    copied beside it.
    """
    out = project / "share" / "datalayer" / "reactor" / "extensions" / name
    out.mkdir(parents=True, exist_ok=True)
    (out / "remoteEntry.js").write_text("var container = {};\n")
    (out / FRONTEND_VERSION_FILE).write_text((project / "frontend" / "package.json").read_text())
    return out


def install(project: Path, prefix: Path) -> Path:
    """Build the wheel and install it into ``prefix``; return its site-packages."""
    wheels = project / "dist"
    pip = [sys.executable, "-m", "pip", "--disable-pip-version-check", "--no-input"]
    subprocess.run(
        [*pip, "wheel", "--no-deps", "--no-build-isolation", "-w", str(wheels), str(project)],
        check=True,
        capture_output=True,
        text=True,
    )
    [wheel] = sorted(wheels.glob("*.whl"), key=lambda path: path.stat().st_mtime)[-1:]
    subprocess.run(
        [*pip, "install", "--no-deps", "--no-build-isolation", "--prefix", str(prefix), str(wheel)],
        check=True,
        capture_output=True,
        text=True,
    )
    site = Path(
        sysconfig.get_path("purelib", vars={"base": str(prefix), "platbase": str(prefix)})
    )
    assert site.is_dir(), site
    return site


def load_installed(site: Path, name: str, monkeypatch: pytest.MonkeyPatch) -> ReactorExtension:
    """Resolve the entry point the wheel advertises, as discovery does.

    From this prefix only: scanning the whole environment would make the test
    depend on whatever else is installed where it runs.
    """
    monkeypatch.syspath_prepend(str(site))
    importlib.invalidate_caches()
    [entry_point] = [
        entry_point
        for distribution in distributions(path=[str(site)])
        for entry_point in distribution.entry_points
        if entry_point.group == EXTENSION_ENTRY_POINT_GROUP and entry_point.name == name
    ]
    return entry_point.load()()


@pytest.fixture
def forget_modules():
    """Each test imports a generated package; none of them outlives it."""
    before = set(sys.modules)
    yield
    for module in set(sys.modules) - before:
        sys.modules.pop(module, None)


def test_the_generator_fills_every_placeholder(tmp_path: Path) -> None:
    project = generate(tmp_path / "acme-charts", "acme-charts")

    files = sorted(
        str(path.relative_to(project)) for path in project.rglob("*") if path.is_file()
    )
    assert files == [
        ".gitignore",
        "LICENSE",
        "acme_charts/__init__.py",
        "acme_charts/_version.py",
        "acme_charts/plugin.py",
        "frontend/LICENSE",
        "frontend/package.json",
        "frontend/rsbuild.config.ts",
        "frontend/src/plugin.tsx",
        "frontend/tsconfig.json",
        "pyproject.toml",
    ]
    for path in project.rglob("*"):
        if path.is_file():
            assert not re.search(r"__(NAME|PACKAGE|PLUGIN)__", path.read_text()), path


def test_the_two_halves_name_each_other_alike(tmp_path: Path) -> None:
    """The names a browser needs are written twice, in two languages: hold them equal."""
    project = generate(tmp_path / "acme-charts", "acme-charts")
    python = (project / "acme_charts" / "__init__.py").read_text()
    config = (project / "frontend" / "rsbuild.config.ts").read_text()
    plugin = (project / "frontend" / "src" / "plugin.tsx").read_text()

    def one(pattern: str, text: str) -> str:
        [found] = re.findall(pattern, text)
        return found

    # The container: its name, its entry file, the module it exposes.
    assert one(r"remote_name=\"([^\"]+)\"", python) == one(r"\bname: '([^']+)'", config)
    assert one(r"entry=\"([^\"]+)\"", python) == one(r"filename: '([^']+)'", config)
    assert one(r"module=\"([^\"]+)\"", python) == one(r"exposes: \{ '([^']+)'", config)
    # Built where the wheel picks it up and the Python half looks for it.
    assert one(r"distPath: \{ root: '([^']+)' \}", config) == (
        "../share/datalayer/reactor/extensions/acme-charts"
    )
    assert 'find_extension_frontend(__file__, "acme-charts")' in python
    # The version it was built at, recorded beside it.
    assert "copy: [{ from: './package.json' }]" in config
    # The frontend plugin is the one the Python half describes.
    assert one(r"name: '(@[^']+)'", plugin) == one(r"name=\"(@[^\"]+)\"", python) == "@acme/charts"


def test_the_wheel_installs_and_a_host_serves_both_halves(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, forget_modules: None
) -> None:
    project = generate(tmp_path / "acme-charts", "acme-charts")
    fake_build(project, "acme-charts")
    site = install(project, tmp_path / "prefix")

    extension = load_installed(site, "acme-charts", monkeypatch)
    # One version, written once in frontend/package.json, on every manifest.
    assert extension.manifest.version == "0.1.0"
    assert [manifest.version for manifest, _ in extension.plugins] == ["0.1.0"]
    assert extension.frontend is not None
    # Served from the installed prefix's share/, not from the project.
    assert extension.frontend.directory.is_relative_to(tmp_path / "prefix")

    platform = PluginPlatform(extension_group=QUIET_GROUP)
    platform.register_extension_object(extension)
    platform.start()
    client = TestClient(create_reactor_app(platform))

    [record] = client.get("/plugins/frontend-extensions").json()
    assert record["name"] == "acme-charts"
    assert record["version"] == "0.1.0"
    assert record["kind"] == "federated"
    assert record["remoteName"] == "acme_charts"
    assert record["module"] == "./plugin"
    assert "refused" not in record
    assert record["backendPlugins"] == ["acme-charts"]
    [plugin] = record["plugins"]
    assert plugin["name"] == "@acme/charts"
    assert plugin["requiredBackendPlugins"] == ["acme-charts"]

    served = client.get(record["entry"])
    assert served.status_code == 200
    assert served.headers["content-type"].startswith("text/javascript")

    plugins = {entry["name"]: entry for entry in client.get("/plugins").json()}
    assert plugins["acme-charts"]["enabled"] is True


def test_a_version_bumped_without_rebuilding_the_frontend_is_refused(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, forget_modules: None
) -> None:
    """The packaging bug the coupling exists for, made the way it is made."""
    project = generate(tmp_path / "acme-stale", "acme-stale")
    fake_build(project, "acme-stale")

    # Bumped, and the wheel rebuilt — but not the frontend.
    package = project / "frontend" / "package.json"
    bumped = json.loads(package.read_text())
    bumped["version"] = "0.2.0"
    package.write_text(json.dumps(bumped, indent=2))
    site = install(project, tmp_path / "prefix")

    extension = load_installed(site, "acme-stale", monkeypatch)
    assert extension.manifest.version == "0.2.0"

    platform = PluginPlatform(extension_group=QUIET_GROUP)
    platform.register_extension_object(extension)
    [record] = TestClient(create_reactor_app(platform)).get(
        "/plugins/frontend-extensions"
    ).json()

    assert "built at 0.1.0" in record["refused"]
    assert "is 0.2.0" in record["refused"]
    # Still listed, so the browser can say so.
    assert [plugin["name"] for plugin in record["plugins"]] == ["@acme/stale"]
