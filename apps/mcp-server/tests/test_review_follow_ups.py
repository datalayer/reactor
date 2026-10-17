# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License
"""What the review of the MCP server plugin found, kept from coming back.

Each test here is one finding: a lifecycle hook the platform never called, a
tool that could never be selected, a server that leaked one toolset's
resources into another's, a router that kept serving a stale application, a
tenant dimension the cache did not have.

Launch the tests:
```
$ pytest tests/test_review_follow_ups.py -v
```
"""

from __future__ import annotations

from importlib.metadata import version

import pytest
from reactor import PluginManifest, PluginPlatform
from reactor.contributions import extension_point
from reactor.types import on_contribution_point

import reactor_mcp_server
from reactor_mcp_server import (
    McpExtension,
    McpHost,
    ToolExtension,
    ToolSpec,
    Toolset,
    manifest_of,
    on_toolset,
    parse_selection,
    tool,
)
from reactor_mcp_server.app import ToolsetRouter
from reactor_mcp_server.points import PROMPTS, RESOURCES, TOOLS


class Lifecycle(McpExtension):
    def __init__(self) -> None:
        self.events: list[str] = []

    def manifest(self) -> PluginManifest:
        return PluginManifest(name="lifecycle", version="1.0.0")

    def on_start(self) -> None:
        self.events.append("start")

    def on_stop(self) -> None:
        self.events.append("stop")


class NoToolsetDeclared(McpExtension):
    """Tools, and nothing said about toolsets."""

    def manifest(self) -> PluginManifest:
        return PluginManifest(name="undeclared", version="1.0.0")

    @tool()
    async def ping(self) -> str:
        """Answer."""
        return "pong"


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
    """Opt-in, held until a URL names its toolset — with a resource, a prompt
    and an `on_server`, so it is visible which server they landed on."""

    def __init__(self) -> None:
        self.servers: list[object] = []
        self.resource_on: list[object] = []
        self.prompt_on: list[object] = []

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

    def resources(self):
        return (self.resource_on.append,)

    def prompts(self):
        return (self.prompt_on.append,)

    def on_server(self, server) -> None:
        self.servers.append(server)


@pytest.fixture
def host() -> McpHost:
    return McpHost(name="tests")


class TestTheLifecycleReachesTheExtension:
    def test_on_start_and_on_stop_are_called_by_the_platform(self, host) -> None:
        """The platform calls `on_reactor_start` and `on_reactor_stop`; an
        extension writes `on_start` and `on_stop`. Both had to exist."""
        extension = Lifecycle()
        host.add(extension)
        host.start()
        host.stop()
        assert extension.events == ["start", "stop"]


class TestEveryToolIsReachable:
    def test_tools_without_a_declared_toolset_are_served(self, host) -> None:
        host.add(NoToolsetDeclared())
        assert "undeclared" in {t.name for t in host.declared_toolsets()}
        assert host.build().tool_names == ("ping",)


class TestWhatAHeldExtensionDeclares:
    def test_its_toolset_is_declared_before_anybody_asks(self, host) -> None:
        """A client is told which name to put in its URL by `/toolsets` —
        which cannot happen if the name appears only once a URL carried it."""
        host.add(Core())
        host.add(Benchmarks())
        names = {t.name for t in host.declared_toolsets()}
        assert names == {"core", "benchmarks"}
        # Declared, not activated: its tools are still absent by default.
        assert host.build().tool_names == ("whoami",)


class TestAServerCarriesOnlyItsSelection:
    def test_resources_prompts_and_on_server_stay_with_the_toolset(self, host) -> None:
        core, benchmarks = Core(), Benchmarks()
        host.add(core)
        host.add(benchmarks)
        # Somebody asked for benchmarks: the extension is awake now.
        with_benchmarks = host.build(parse_selection("benchmarks"))
        assert benchmarks.servers == [with_benchmarks.server]
        assert benchmarks.resource_on == [with_benchmarks.server]
        assert benchmarks.prompt_on == [with_benchmarks.server]
        # A default client, after that: nothing of benchmarks on its server.
        default = host.build()
        assert default.server is not with_benchmarks.server
        assert benchmarks.servers == [with_benchmarks.server]
        assert benchmarks.resource_on == [with_benchmarks.server]
        assert benchmarks.prompt_on == [with_benchmarks.server]


class TestTheRouterFollowsTheHost:
    def test_applications_are_dropped_when_the_host_rebuilds(self, host) -> None:
        router = ToolsetRouter(host)
        router._apps["core"] = object()
        router._refresh()
        assert "core" in router._apps
        host.forget_built()
        router._refresh()
        assert router._apps == {}

    def test_adding_an_extension_bumps_the_revision(self, host) -> None:
        before = host.revision
        host.add(Core())
        assert host.revision > before


class TestTenantsDoNotShareAServer:
    def test_a_tenant_has_its_own_cache_entry(self, host) -> None:
        host.add(Core())
        everybody = host.build()
        tenant = host.build(tenant_id="acme")
        assert tenant.server is not everybody.server
        assert set(host._built) == {(None, "core"), ("acme", "core")}


class TestExtendingKeepsTheDescription:
    def test_a_wrapper_without_a_description_keeps_the_docstring(self) -> None:
        async def launch(name: str) -> str:
            """Launch a sandbox."""
            return name

        def wrap(handler):
            async def wrapped(name: str) -> str:
                return await handler(name)

            return wrapped

        spec = ToolSpec(name="launch", handler=launch)
        applied = ToolExtension(wrap=wrap).apply(spec)
        assert applied.handler is not launch
        assert applied.documentation == "Launch a sandbox."


class TestWhatTheManifestSays:
    def test_it_declares_resources_and_prompts_too(self) -> None:
        points = manifest_of(Benchmarks()).contribution_points
        assert RESOURCES.id in points
        assert PROMPTS.id in points

    def test_the_version_is_the_distribution_s(self) -> None:
        assert reactor_mcp_server.__version__ == version("reactor_mcp_server")


class TestReadingAnExtensionWakesItsPlugin:
    def test_a_plugin_held_on_the_derived_point_is_read(self) -> None:
        """A plugin that exists only to extend one tool waits on
        `onContributionPoint:<point>::<target>`; reading that tool's
        extensions is what should wake it."""
        platform = PluginPlatform()
        derived = extension_point(TOOLS, "launch")

        class Narrows:
            def provide_contributions(self, contributions) -> None:
                contributions.extend(TOOLS, "launch", ToolExtension(title="Narrowed"))

        platform.register_plugin(
            PluginManifest(
                name="narrows",
                version="1.0.0",
                contribution_points=[derived.id],
                activation_events=[on_contribution_point(derived.id)],
            ),
            Narrows(),
        )
        platform.start()
        found = platform.get_contribution_extensions(TOOLS, "launch")
        assert [item.value.title for item in found] == ["Narrowed"]
