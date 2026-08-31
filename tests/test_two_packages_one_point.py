# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Two distributions, two extensions, one set of contribution points.

The shape `examples/cms` demonstrates, as a test — written against the runtime
rather than against the example, so it runs in CI where neither `cms` nor
`cms-pro` is installed.

The claim being pinned down is the one the CMS exists to make:

    Python package → Extension → Plugin → Contribution → Contribution point

Packaging sits at the top of that chain and the extension mechanism at the
bottom, and **nothing in between knows which package a plugin came from**. A
free tier and a paid tier fill the same point ids, register on the same
platform, and are indistinguishable to the host.
"""

from __future__ import annotations

import json
import textwrap
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from reactor import (
    ExtensionManifest,
    FrontendExtension,
    FrontendPlugin,
    PluginManifest,
    PluginPlatform,
    ReactorExtension,
    create_reactor_app,
    define_contribution_point,
)

TEST_GROUP = "datalayer.reactor.two-package-test"

EDITOR_TOOLBAR = define_contribution_point("cms.editorToolbar")
CONTENT_TYPES = define_contribution_point("cms.contentType")
PUBLISH_LIFECYCLE = define_contribution_point("cms.publishLifecycle")


def tier(name: str, label: str, prefix: str) -> ReactorExtension:
    """One tier: three plugins, one per point. Free and paid differ only here."""

    class Toolbar:
        def provide_contributions(self, contributions) -> None:
            contributions.contribute(
                EDITOR_TOOLBAR, {"label": f"{label} tool"}, contribution_id=f"{prefix}-tool"
            )

    class Types:
        def provide_contributions(self, contributions) -> None:
            contributions.contribute(
                CONTENT_TYPES, {"label": f"{label} type"}, contribution_id=f"{prefix}-type"
            )

    class Lifecycle:
        def provide_contributions(self, contributions) -> None:
            contributions.contribute(
                PUBLISH_LIFECYCLE, {"label": f"{label} step"}, contribution_id=f"{prefix}-step"
            )

    return ReactorExtension(
        manifest=ExtensionManifest(name=name, display_name=label),
        plugins=[
            (PluginManifest(name=f"{prefix}.toolbar", version="1.0.0"), Toolbar()),
            (PluginManifest(name=f"{prefix}.types", version="1.0.0"), Types()),
            (PluginManifest(name=f"{prefix}.lifecycle", version="1.0.0"), Lifecycle()),
        ],
    )


def test_a_paid_tier_is_indistinguishable_from_a_free_one() -> None:
    platform = PluginPlatform(extension_group=TEST_GROUP)
    platform._register_extension_object("cms", tier("Core", "Core", "core"))  # noqa: SLF001
    platform._register_extension_object("cms-pro", tier("Pro", "Pro", "pro"))  # noqa: SLF001

    # Every point holds one contribution from each tier. Not "the free one and
    # then the paid one" — the registry has no such concept.
    expected = {
        EDITOR_TOOLBAR: {"core.toolbar", "pro.toolbar"},
        CONTENT_TYPES: {"core.types", "pro.types"},
        PUBLISH_LIFECYCLE: {"core.lifecycle", "pro.lifecycle"},
    }
    for point, contributors in expected.items():
        assert {
            entry.plugin for entry in platform.get_contributions(point)
        } == contributors, point.id

    # The grouping survives, because it is the answer to "what would I
    # uninstall to lose this?" — and it is the only place the tiers differ.
    grouped = {e["name"]: e["plugins"] for e in platform.list_extensions()}
    assert set(grouped) == {"Core", "Pro"}
    assert len(grouped["Core"]) == len(grouped["Pro"]) == 3


def test_uninstalling_the_paid_tier_leaves_the_free_one_whole() -> None:
    platform = PluginPlatform(extension_group=TEST_GROUP)
    platform._register_extension_object("cms", tier("Core", "Core", "core"))  # noqa: SLF001
    platform._register_extension_object("cms-pro", tier("Pro", "Pro", "pro"))  # noqa: SLF001

    platform._forget_extension("cms-pro")  # noqa: SLF001

    for point in (EDITOR_TOOLBAR, CONTENT_TYPES, PUBLISH_LIFECYCLE):
        plugins = {entry.plugin for entry in platform.get_contributions(point)}
        assert all(name.startswith("core.") for name in plugins), point.id
        assert len(plugins) == 1, point.id

    assert [e["name"] for e in platform.list_extensions()] == ["Core"]


def test_disabling_one_plugin_leaves_its_siblings_running() -> None:
    """Grouping is delivery, not governance.

    An extension is what you uninstall; it is not a switch. Turning one of its
    plugins off must not take the other two with it — they do not depend on it,
    and being delivered together is not a dependency.
    """
    platform = PluginPlatform(extension_group=TEST_GROUP)
    platform._register_extension_object("cms", tier("Core", "Core", "core"))  # noqa: SLF001

    platform.disable_plugin("core.types")

    assert platform.get_contributions(CONTENT_TYPES) == []
    assert len(platform.get_contributions(EDITOR_TOOLBAR)) == 1
    assert len(platform.get_contributions(PUBLISH_LIFECYCLE)) == 1


def _write_tier_distribution(root: Path, dist: str, module: str, label: str) -> None:
    """A distribution advertising one extension, the way pip installs one."""
    package = root / module
    package.mkdir(parents=True, exist_ok=True)
    share = root / "share" / dist
    share.mkdir(parents=True, exist_ok=True)
    (share / "index.js").write_text(f"export default {{ tier: '{label}' }};")

    (package / "__init__.py").write_text(
        textwrap.dedent(
            f"""
            from pathlib import Path

            from reactor import (
                ExtensionManifest, FrontendExtension, FrontendPlugin,
                PluginManifest, ReactorExtension,
            )

            def extension() -> ReactorExtension:
                return ReactorExtension(
                    manifest=ExtensionManifest(name="{label}", display_name="{label}"),
                    plugins=[(PluginManifest(name="{module}.toolbar", version="1.0.0"), object())],
                    frontend=FrontendExtension(
                        directory=Path(__file__).resolve().parent.parent / "share" / "{dist}",
                        plugins=[FrontendPlugin(name="@{dist}/toolbar")],
                    ),
                )
            """
        )
    )

    dist_info = root / f"{module}-0.1.0.dist-info"
    dist_info.mkdir(exist_ok=True)
    (dist_info / "METADATA").write_text(
        f"Metadata-Version: 2.1\nName: {dist}\nVersion: 0.1.0\n"
    )
    (dist_info / "entry_points.txt").write_text(
        f"[{TEST_GROUP}]\n{dist} = {module}:extension\n"
    )


def test_buying_the_paid_tier_while_the_server_runs(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The demonstration, end to end: install a second package mid-flight.

    This is what `pip install cms-pro` against a running `datalayer-cms` does,
    with the distributions written by hand so the test owns everything it
    depends on.
    """
    site = tmp_path / "site-packages"
    site.mkdir()
    monkeypatch.syspath_prepend(str(site))
    _write_tier_distribution(site, "cmsfree", "cmsfree_ext", "Core")

    platform = PluginPlatform(extension_group=TEST_GROUP)
    platform.start()
    client = TestClient(create_reactor_app(platform))

    first = client.get("/plugins/frontend-extensions").json()
    assert [record["name"] for record in first] == ["Core"]

    # The purchase.
    _write_tier_distribution(site, "cmspaid", "cmspaid_ext", "Pro")

    second = client.get("/plugins/frontend-extensions").json()
    assert sorted(record["name"] for record in second) == ["Core", "Pro"]

    # Both halves arrived: the Python plugin is registered, and the browser
    # half is servable — with no mount having been added for it.
    names = {plugin["name"] for plugin in client.get("/plugins").json()}
    assert {"cmsfree_ext.toolbar", "cmspaid_ext.toolbar"} <= names

    paid = next(record for record in second if record["name"] == "Pro")
    served = client.get(paid["entry"])
    assert served.status_code == 200
    assert "Pro" in served.text
