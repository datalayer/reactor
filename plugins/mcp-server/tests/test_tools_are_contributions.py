# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Tools are offered, not registered — and an offer can be extended.

The behaviour this package exists for: an extension narrows a tool another
extension offered, and the result does not depend on which distribution the
installer happened to load first.

Launch the tests:
```
$ pytest tests/test_tools_are_contributions.py -v
```
"""

from __future__ import annotations

import pytest
from reactor import PluginManifest

from reactor_mcp_server import (
    McpExtension,
    McpHost,
    Selection,
    ToolExtension,
    ToolSpec,
    Toolset,
    tool,
)


class Sandboxes(McpExtension):
    """Offers the tool the other extensions act on."""

    def manifest(self) -> PluginManifest:
        return PluginManifest(name="sandboxes", version="1.0.0")

    @tool(title="Launch Sandbox")
    async def launch_sandbox(self, sandbox_name: str, variant: str = "eval") -> dict:
        """Launch a sandbox for this session to run code in."""
        return {"sandbox": sandbox_name, "variant": variant}


class Narrows(McpExtension):
    """Extends somebody else's tool rather than offering a rival."""

    def manifest(self) -> PluginManifest:
        return PluginManifest(name="narrows", version="1.0.0")

    def tools(self):
        return ()

    def tool_extensions(self):
        def only_datalayer(handler):
            async def narrowed(sandbox_name: str, variant: str = "datalayer") -> dict:
                answer = await handler(sandbox_name, variant=variant)
                answer["narrowed_by"] = "narrows"
                return answer

            return narrowed

        return (
            (
                "launch_sandbox",
                ToolExtension(
                    wrap=only_datalayer,
                    description="Launch a sandbox on Datalayer.",
                ),
            ),
        )


@pytest.fixture
def host() -> McpHost:
    return McpHost(name="tests")


class TestWhatAnExtensionOffers:
    def test_a_decorated_method_is_a_tool(self, host) -> None:
        host.add(Sandboxes())

        [spec] = host.offered_tools()

        assert spec.name == "launch_sandbox"
        assert spec.title == "Launch Sandbox"
        assert spec.documentation.startswith("Launch a sandbox")

    def test_a_tool_lands_in_its_extension_s_toolset_by_default(self, host) -> None:
        """So every tool is in exactly one toolset and none falls outside
        what a URL can reach."""
        host.add(Sandboxes())

        [spec] = host.offered_tools()

        assert spec.toolset == "sandboxes"

    def test_the_handler_is_the_bound_method(self, host) -> None:
        """A tool that could not reach its extension's own state would have
        to keep it in a module global, which is the same thing with worse
        lifetime."""
        extension = Sandboxes()
        host.add(extension)

        [spec] = host.offered_tools()

        assert spec.handler.__self__ is extension

    def test_a_tool_needs_a_name_and_a_handler(self) -> None:
        with pytest.raises(ValueError):
            ToolSpec(name="", handler=lambda: None)
        with pytest.raises(ValueError):
            ToolSpec(name="x", handler=None)  # type: ignore[arg-type]


class TestExtendingAnotherExtensionSTool:
    async def test_the_wrapper_runs_and_the_tool_still_does(self, host) -> None:
        host.add(Sandboxes())
        host.add(Narrows())

        [spec] = host.offered_tools()
        answer = await spec.handler("demo")

        assert answer["sandbox"] == "demo"
        assert answer["narrowed_by"] == "narrows"
        assert answer["variant"] == "datalayer"

    def test_the_description_a_model_reads_is_the_narrowed_one(self, host) -> None:
        host.add(Sandboxes())
        host.add(Narrows())

        [spec] = host.offered_tools()

        assert spec.documentation == "Launch a sandbox on Datalayer."

    def test_it_is_still_one_tool(self, host) -> None:
        """Not two with the same name, which is what registering a rival
        produced — and which the SDK resolved by keeping whichever arrived
        first."""
        host.add(Sandboxes())
        host.add(Narrows())

        assert [spec.name for spec in host.offered_tools()] == ["launch_sandbox"]

    def test_order_of_registration_does_not_decide_the_outcome(self) -> None:
        """The whole point. Both orders give the same tool, so an extension
        does not have to be named to sort after the one it extends."""
        first = McpHost(name="tests")
        first.add(Sandboxes())
        first.add(Narrows())
        second = McpHost(name="tests")
        second.add(Narrows())
        second.add(Sandboxes())

        assert [spec.documentation for spec in first.offered_tools()] == [
            spec.documentation for spec in second.offered_tools()
        ]

    def test_extending_a_tool_nobody_offered_does_nothing(self, host) -> None:
        host.add(Narrows())

        assert host.offered_tools() == []

    def test_two_extensions_of_one_tool_compose_in_order(self, host) -> None:
        class Outer(McpExtension):
            def manifest(self) -> PluginManifest:
                return PluginManifest(name="outer", version="1.0.0")

            def tools(self):
                return ()

            def tool_extensions(self):
                return (("launch_sandbox", ToolExtension(description="outer")),)

        host.add(Sandboxes())
        host.add(Narrows())
        host.add(Outer())

        [spec] = host.offered_tools()

        # `narrows` contributed first, `outer` second, and the later one wins
        # the description — a defined order rather than an accident.
        assert spec.documentation == "outer"

    async def test_a_broken_extension_costs_its_tool_not_the_server(self, host) -> None:
        """A tool served half-extended is worse than one not served: an
        extension that narrows and fails to would widen it instead."""

        class Broken(McpExtension):
            def manifest(self) -> PluginManifest:
                return PluginManifest(name="broken", version="1.0.0")

            def tools(self):
                return ()

            def tool_extensions(self):
                def explode(handler):
                    raise RuntimeError("no")

                return (("launch_sandbox", ToolExtension(wrap=explode)),)

        class Other(McpExtension):
            def manifest(self) -> PluginManifest:
                return PluginManifest(name="other", version="1.0.0")

            @tool()
            async def ping(self) -> str:
                """Answer."""
                return "pong"

        host.add(Sandboxes())
        host.add(Broken())
        host.add(Other())

        assert [spec.name for spec in host.offered_tools()] == ["ping"]


class TestBuildingTheServer:
    def test_the_built_server_carries_what_it_was_built_from(self, host) -> None:
        host.add(Sandboxes())

        built = host.build()

        assert built.tool_names == ("launch_sandbox",)
        assert built.toolsets == frozenset({"sandboxes"})

    def test_the_same_selection_builds_once(self, host) -> None:
        host.add(Sandboxes())

        assert host.build() is host.build(Selection())

    def test_adding_an_extension_invalidates_what_was_built(self, host) -> None:
        """A cached server would go on serving the list it was built with,
        and the extension that just arrived would be installed and invisible."""

        class Extra(McpExtension):
            def manifest(self) -> PluginManifest:
                return PluginManifest(name="extra", version="1.0.0")

            @tool()
            async def ping(self) -> str:
                """Answer."""
                return "pong"

        host.add(Sandboxes())
        before = host.build()

        host.add(Extra())
        after = host.build()

        assert before is not after
        assert "ping" in after.tool_names
