# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""What a URL asks for, and what it gets.

A hosted MCP server serves one endpoint to everybody. `?benchmarks` is how a
client says it came for the benchmark tools, and an extension whose toolset
nobody asked for should cost that client nothing — not a tool in its list, and
not a plugin registered in the process.

Launch the tests:
```
$ pytest tests/test_activation_by_url.py -v
```
"""

from __future__ import annotations

import pytest
from reactor import PluginManifest

from reactor_mcp_server import (
    McpExtension,
    McpHost,
    Selection,
    Toolset,
    activation_key,
    active_toolsets,
    on_toolset,
    parse_selection,
    tool,
    unknown_names,
)

DECLARED = (
    Toolset(name="core", always=True),
    Toolset(name="spaces"),
    Toolset(name="benchmarks", default=False),
    Toolset(name="library", default=False),
)


def chosen(query: str) -> set[str]:
    return set(active_toolsets(DECLARED, parse_selection(query)))


class TestReadingTheQuery:
    def test_a_bare_flag_is_a_toolset_name(self) -> None:
        """The spelling somebody types into an agent's configuration."""
        assert parse_selection("benchmarks").named == frozenset({"benchmarks"})

    def test_several_flags(self) -> None:
        assert parse_selection("benchmarks&library").named == frozenset(
            {"benchmarks", "library"}
        )

    def test_a_list_under_the_reserved_key(self) -> None:
        assert parse_selection("toolsets=benchmarks,library").named == frozenset(
            {"benchmarks", "library"}
        )

    def test_a_flag_with_a_value_is_still_a_name(self) -> None:
        """`?benchmarks=1` is what somebody types when their client insists
        on values; reading it as a name is what they meant."""
        assert parse_selection("benchmarks=1").named == frozenset({"benchmarks"})

    def test_only_and_without_are_not_toolset_names(self) -> None:
        selection = parse_selection("only=spaces&without=library")

        assert selection.only == frozenset({"spaces"})
        assert selection.without == frozenset({"library"})
        assert selection.named == frozenset()

    def test_no_query_asks_for_nothing(self) -> None:
        assert parse_selection("").is_empty
        assert parse_selection(None).is_empty


class TestWhatIsActivated:
    def test_nothing_asked_means_the_default_toolsets(self) -> None:
        assert chosen("") == {"core", "spaces"}

    def test_asking_for_one_adds_it_to_the_defaults(self) -> None:
        """Additive on purpose: a client that names the toolset it came for
        should not lose the tools it was getting before it knew to ask."""
        assert chosen("benchmarks") == {"core", "spaces", "benchmarks"}

    def test_only_narrows_to_exactly_what_was_named(self) -> None:
        assert chosen("only=benchmarks") == {"core", "benchmarks"}

    def test_an_always_on_toolset_survives_only(self) -> None:
        """Or `only=` produces an endpoint with no way to ask anything."""
        assert "core" in chosen("only=benchmarks")

    def test_without_removes_a_default(self) -> None:
        assert chosen("without=spaces") == {"core"}

    def test_without_cannot_remove_an_always_on_one(self) -> None:
        assert "core" in chosen("without=core")

    def test_a_name_nobody_declared_is_ignored_not_refused(self) -> None:
        """A stale name in an agent's configuration must not take a working
        client's connection down."""
        assert chosen("nosuchtoolset") == {"core", "spaces"}

    def test_but_it_is_reported(self) -> None:
        unknown = unknown_names(DECLARED, parse_selection("nosuchtoolset"))

        assert unknown == frozenset({"nosuchtoolset"})

    def test_the_order_of_the_query_does_not_make_a_second_server(self) -> None:
        assert activation_key(chosen("benchmarks&library")) == activation_key(
            chosen("library&benchmarks")
        )


class Core(McpExtension):
    def manifest(self) -> PluginManifest:
        return PluginManifest(name="core", version="1.0.0")

    def toolsets(self):
        return (Toolset(name="core", always=True),)

    @tool()
    async def whoami(self) -> str:
        """Who the caller is."""
        return "somebody"


class Benchmarks(McpExtension):
    """Opt-in: registered only once a URL names its toolset."""

    def manifest(self) -> PluginManifest:
        return PluginManifest(
            name="benchmarks",
            version="1.0.0",
            activation_events=[on_toolset("benchmarks")],
        )

    def toolsets(self):
        return (Toolset(name="benchmarks", default=False),)

    @tool()
    async def run_benchmark(self, name: str) -> str:
        """Run one."""
        return name


@pytest.fixture
def host() -> McpHost:
    built = McpHost(name="tests")
    built.add(Core())
    built.add(Benchmarks())
    built.start()
    return built


class TestAHostServingThem:
    def test_an_opt_in_toolset_is_absent_until_it_is_asked_for(self, host) -> None:
        built = host.build()

        assert built.tool_names == ("whoami",)
        assert "benchmarks" not in built.toolsets

    def test_asking_for_it_brings_its_tools(self, host) -> None:
        built = host.build(parse_selection("benchmarks"))

        assert set(built.tool_names) == {"whoami", "run_benchmark"}

    def test_the_held_plugin_is_activated_by_the_ask(self, host) -> None:
        """Not merely filtered out before: a plugin nobody asked for is not
        registered, contributes nothing and costs nothing."""
        activated = lambda: {
            plugin["name"]
            for plugin in host.platform.list_plugins()
            if plugin["activated"]
        }
        before = activated()
        host.build(parse_selection("benchmarks"))
        after = activated()

        assert "benchmarks" not in before
        assert "benchmarks" in after

    def test_two_selections_are_two_servers(self, host) -> None:
        plain = host.build()
        with_benchmarks = host.build(parse_selection("benchmarks"))

        assert plain is not with_benchmarks
        assert plain.server is not with_benchmarks.server

    def test_the_same_selection_is_the_same_server(self, host) -> None:
        assert host.build(parse_selection("benchmarks")) is host.build(
            parse_selection("toolsets=benchmarks")
        )

    def test_a_client_that_asked_for_nothing_still_gets_the_always_on_tools(
        self, host
    ) -> None:
        built = host.build(Selection(only=frozenset()))

        assert built.tool_names == ("whoami",)


class TestTwoExtensionsOnOneToolset:
    """A toolset name is a subject, not a plugin.

    A deployment that adds its own tools to `sandboxes` declares the same
    name, which is how they arrive together — and how a client asking what
    there is was told about `sandboxes` twice, with two descriptions.
    """

    def _host(self):
        from reactor import PluginCompatibility, PluginManifest
        from reactor_mcp_server import McpExtension, ToolSpec, Toolset, build_host

        class Ships(McpExtension):
            def manifest(self):
                return PluginManifest(
                    name="ships",
                    version="0.0.1",
                    compatibility=PluginCompatibility(api_version="v1"),
                )

            def toolsets(self):
                return (Toolset(name="sandboxes", description="Launch and use one."),)

            def tools(self):
                async def launch_sandbox(name: str) -> str:
                    """Launch one."""
                    return name

                return [ToolSpec(name="launch_sandbox", handler=launch_sandbox)]

        class AddsToIt(McpExtension):
            def manifest(self):
                return PluginManifest(
                    name="adds",
                    version="0.0.1",
                    compatibility=PluginCompatibility(api_version="v1"),
                )

            def toolsets(self):
                return (Toolset(name="sandboxes", description="And these too."),)

            def tools(self):
                async def snapshot_sandbox(name: str) -> str:
                    """Keep its state."""
                    return name

                return [ToolSpec(name="snapshot_sandbox", handler=snapshot_sandbox)]

        return build_host([Ships(), AddsToIt()], name="tests")

    def test_it_is_listed_once(self) -> None:
        declared = self._host().declared_toolsets()
        assert [toolset.name for toolset in declared] == ["sandboxes"]

    def test_described_by_the_first_that_declared_it(self) -> None:
        assert self._host().declared_toolsets()[0].description == "Launch and use one."

    def test_and_both_extensions_tools_are_in_it(self) -> None:
        from reactor_mcp_server import parse_selection

        built = self._host().build(parse_selection("only=sandboxes"))
        assert set(built.tool_names) == {"launch_sandbox", "snapshot_sandbox"}
