# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Extending somebody else's contribution.

A plugin offers a tool; another plugin wants to add to *that* tool rather than
offer a rival one. Before this, its only lever was to contribute a replacement
and hope to be read last — which makes the result depend on the order plugins
happened to load in, so it works on the machine where the names sort the right
way and nowhere else.
"""

from __future__ import annotations

import pytest

from reactor import (
    ContributionRegistry,
    PluginContributions,
    PluginManifest,
    PluginPlatform,
    define_contribution_point,
    extension_point,
)

TOOLS = define_contribution_point("tests.mcp.tools")
VIEWS = define_contribution_point("tests.viewType")


@pytest.fixture
def registry() -> ContributionRegistry:
    return ContributionRegistry()


def plugin(registry: ContributionRegistry, name: str) -> PluginContributions:
    return PluginContributions(registry, name)


class TestWhereAnExtensionGoes:
    def test_it_is_a_point_of_its_own_per_target(self) -> None:
        assert extension_point(TOOLS, "launch").id == "tests.mcp.tools::launch"
        assert extension_point(TOOLS, "use").id != extension_point(TOOLS, "launch").id

    def test_extending_nothing_is_refused(self) -> None:
        with pytest.raises(ValueError):
            extension_point(TOOLS, "")

    def test_an_extension_does_not_show_up_among_the_contributions(self, registry) -> None:
        """Or every host reading a point would have to know which of its
        entries are things and which are notes about other things."""
        plugin(registry, "foo").contribute(TOOLS, "launch", contribution_id="launch")
        plugin(registry, "bar").extend(TOOLS, "launch", "narrower")

        assert [item.value for item in registry.get(TOOLS)] == ["launch"]


class TestReadingThemBack:
    def test_in_order_rather_than_in_load_order(self, registry) -> None:
        plugin(registry, "late").extend(TOOLS, "launch", "third", order=30)
        plugin(registry, "early").extend(TOOLS, "launch", "first", order=10)
        plugin(registry, "middle").extend(TOOLS, "launch", "second", order=20)

        found = registry.extensions_of(TOOLS, "launch")

        assert [item.value for item in found] == ["first", "second", "third"]

    def test_each_one_says_which_plugin_it_came_from(self, registry) -> None:
        plugin(registry, "bar").extend(TOOLS, "launch", "narrower")

        [extension] = registry.extensions_of(TOOLS, "launch")

        assert extension.plugin == "bar"

    def test_an_extension_of_an_absent_target_is_simply_never_applied(self, registry) -> None:
        """Extending a tool nobody contributed is an ordinary configuration —
        the extension is stored, the target is not there, nothing happens."""
        plugin(registry, "bar").extend(TOOLS, "launch", "narrower")

        assert registry.get(TOOLS) == []
        assert len(registry.extensions_of(TOOLS, "launch")) == 1

    def test_extensions_of_one_target_are_not_another_target_s(self, registry) -> None:
        plugin(registry, "bar").extend(TOOLS, "launch", "for launch")
        plugin(registry, "bar").extend(TOOLS, "use", "for use")

        assert [item.value for item in registry.extensions_of(TOOLS, "launch")] == ["for launch"]

    def test_they_are_filtered_by_plugin_like_everything_else(self, registry) -> None:
        plugin(registry, "bar").extend(TOOLS, "launch", "from bar")
        plugin(registry, "baz").extend(TOOLS, "launch", "from baz")

        found = registry.extensions_of(TOOLS, "launch", plugins={"bar"})

        assert [item.value for item in found] == ["from bar"]


class TestTheyBelongToTheirPlugin:
    def test_disposing_one_takes_its_extensions_with_it(self, registry) -> None:
        plugin(registry, "foo").contribute(TOOLS, "launch", contribution_id="launch")
        plugin(registry, "bar").extend(TOOLS, "launch", "narrower")

        registry.dispose_plugin("bar")

        assert registry.extensions_of(TOOLS, "launch") == []
        assert len(registry.get(TOOLS)) == 1

    def test_an_extension_can_be_undone_on_its_own(self, registry) -> None:
        dispose = plugin(registry, "bar").extend(TOOLS, "launch", "narrower")

        dispose()

        assert registry.extensions_of(TOOLS, "launch") == []


class TestThroughThePlatform:
    def test_a_plugin_extends_another_plugin_s_contribution(self) -> None:
        """The whole point, end to end: two plugins, neither knowing the
        other's load order, and the host reads one tool with one extension."""

        class Offers:
            def provide_contributions(self, contributions) -> None:
                contributions.contribute(
                    VIEWS, {"title": "Notebook"}, contribution_id="notebook"
                )

        class Extends:
            def provide_contributions(self, contributions) -> None:
                contributions.extend(VIEWS, "notebook", {"adds": "outline"})

        platform = PluginPlatform()
        platform.register_plugin(
            PluginManifest(name="offers", version="1.0.0"), Offers()
        )
        platform.register_plugin(
            PluginManifest(name="extends", version="1.0.0"), Extends()
        )

        [view] = platform.get_contributions(VIEWS)
        [addition] = platform.get_contribution_extensions(VIEWS, "notebook")

        assert view.value == {"title": "Notebook"}
        assert addition.value == {"adds": "outline"}
        assert addition.plugin == "extends"
