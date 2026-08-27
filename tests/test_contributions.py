# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Extension points: plugins offer, the host chooses."""

from __future__ import annotations

import pytest

from reactor import (
    ContributionRegistry,
    PluginContributions,
    PluginManifest,
    PluginPlatform,
    define_extension_point,
)

VIEW = define_extension_point("tests.viewType")
PANEL = define_extension_point("tests.panel")


class _ViewPlugin:
    """Contributes two views at declaration time."""

    def provide_contributions(self, contributions) -> None:
        contributions.contribute(
            VIEW, {"title": "Notebook"}, contribution_id="notebook", order=10
        )
        contributions.contribute(
            VIEW, {"title": "Console"}, contribution_id="console", order=1
        )


class _PanelPlugin:
    def provide_contributions(self, contributions) -> None:
        contributions.contribute(PANEL, {"title": "Logs"}, contribution_id="logs")


class _BrokenPlugin:
    def provide_contributions(self, contributions) -> None:
        raise RuntimeError("this plugin is having a bad day")


class _RenamedParameterPlugin:
    """Names its parameter differently: the hook is called positionally."""

    def provide_contributions(self, registry) -> None:
        registry.contribute(VIEW, {"title": "Renamed"}, contribution_id="renamed")


def _manifest(name: str, **kwargs) -> PluginManifest:
    return PluginManifest(name=name, version="1.0.0", **kwargs)


class TestRegistry:
    def test_orders_by_order_then_contribution_order(self) -> None:
        registry = ContributionRegistry()
        registry.add("a", VIEW, "second", order=10)
        registry.add("b", VIEW, "first", order=-1)
        registry.add("c", VIEW, "third", order=10)

        assert [c.value for c in registry.get(VIEW)] == ["first", "second", "third"]

    def test_defaults_the_contribution_id_to_the_plugin_name(self) -> None:
        registry = ContributionRegistry()
        registry.add("weather", VIEW, "forecast")

        assert registry.get(VIEW)[0].id == "weather"
        assert registry.get(VIEW)[0].plugin == "weather"

    def test_points_do_not_leak_into_each_other(self) -> None:
        registry = ContributionRegistry()
        registry.add("a", VIEW, "a view")
        registry.add("a", PANEL, "a panel")

        assert [c.value for c in registry.get(VIEW)] == ["a view"]
        assert [c.value for c in registry.get(PANEL)] == ["a panel"]

    def test_dispose_is_idempotent(self) -> None:
        registry = ContributionRegistry()
        dispose = registry.add("a", VIEW, "temporary")

        dispose()
        dispose()

        assert registry.get(VIEW) == []
        assert registry.points() == ()

    def test_dispose_plugin_drops_only_that_plugin(self) -> None:
        registry = ContributionRegistry()
        registry.add("keep", VIEW, "kept")
        registry.add("drop", VIEW, "dropped")
        registry.add("drop", PANEL, "also dropped")

        assert registry.dispose_plugin("drop") == 2
        assert [c.value for c in registry.get(VIEW)] == ["kept"]
        assert registry.get(PANEL) == []

    def test_bound_view_contributes_as_its_plugin(self) -> None:
        registry = ContributionRegistry()
        view = PluginContributions(registry, "weather")

        view.contribute(VIEW, "forecast")

        assert view.plugin_name == "weather"
        assert registry.get(VIEW)[0].plugin == "weather"


class TestPlatform:
    def test_a_plugin_contributes_when_it_registers(self) -> None:
        platform = PluginPlatform()
        platform.register_plugin(_manifest("views"), _ViewPlugin())

        assert [c.id for c in platform.get_contributions(VIEW)] == [
            "console",
            "notebook",
        ]

    def test_the_hook_is_called_positionally(self) -> None:
        platform = PluginPlatform()
        platform.register_plugin(_manifest("renamed"), _RenamedParameterPlugin())

        assert [c.id for c in platform.get_contributions(VIEW)] == ["renamed"]

    def test_a_plugin_that_fails_to_contribute_still_registers(self) -> None:
        platform = PluginPlatform()
        platform.register_plugin(_manifest("broken"), _BrokenPlugin())
        platform.register_plugin(_manifest("views"), _ViewPlugin())

        # One bad extension does not take the host down with it, and the good
        # one is unaffected.
        assert "broken" in [p["name"] for p in platform.list_plugins()]
        assert [c.id for c in platform.get_contributions(VIEW)] == [
            "console",
            "notebook",
        ]

    def test_disabling_hides_contributions_and_enabling_brings_them_back(self) -> None:
        platform = PluginPlatform()
        platform.register_plugin(_manifest("views"), _ViewPlugin())

        platform.disable_plugin("views")
        assert platform.get_contributions(VIEW) == []

        # Disabling is reversible, so the contributions were kept, not dropped.
        platform.enable_plugin("views")
        assert len(platform.get_contributions(VIEW)) == 2

    def test_unregistering_disposes_contributions(self) -> None:
        platform = PluginPlatform()
        platform.register_plugin(_manifest("views"), _ViewPlugin())

        platform.unregister_plugin("views")

        assert platform.get_contributions(VIEW) == []
        assert platform.list_plugins() == []
        with pytest.raises(KeyError):
            platform.contributions_for("views")

    def test_tenant_scoping_filters_what_a_tenant_can_see(self) -> None:
        platform = PluginPlatform()
        platform.register_plugin(
            _manifest("views", tenant_scopes=["acme"]), _ViewPlugin()
        )
        platform.register_plugin(_manifest("panels"), _PanelPlugin())

        # `views` is scoped to acme; `panels` is scoped to everyone.
        assert len(platform.get_contributions(VIEW, tenant_id="acme")) == 2
        assert platform.get_contributions(VIEW, tenant_id="other") == []
        assert len(platform.get_contributions(PANEL, tenant_id="other")) == 1

    def test_a_plugin_can_contribute_after_startup(self) -> None:
        platform = PluginPlatform()
        platform.register_plugin(_manifest("views"), _ViewPlugin())

        dispose = platform.contributions_for("views").contribute(
            VIEW, {"title": "Later"}, contribution_id="later", order=99
        )

        assert [c.id for c in platform.get_contributions(VIEW)][-1] == "later"
        dispose()
        assert "later" not in [c.id for c in platform.get_contributions(VIEW)]
