# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Building an MCP server out of what extensions offered.

The host side of the bargain: extensions offer tools, this reads the offers
and builds a server. Everything interesting happens here rather than in the
extensions — which toolsets are on, which extensions of a tool apply, what a
client ends up seeing — because that is the part that has to change per
request while the extensions stay the same.

@module reactor_mcp_server.server
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field, replace
from typing import Any, Iterable, Optional

from mcp.server.mcpserver import MCPServer
from reactor import PluginPlatform

from reactor_mcp_server.extension import McpExtension, manifest_of
from reactor_mcp_server.points import PROMPTS, RESOURCES, TOOLS, TOOLSETS, on_toolset
from reactor_mcp_server.tools import ToolSpec, resolve
from reactor_mcp_server.toolsets import (
    Selection,
    Toolset,
    activation_key,
    active_toolsets,
    unknown_names,
)

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class BuiltServer:
    """A server, and what it was built from — so a host can say why.

    "Which tools am I getting and why" is the question a hosted MCP endpoint
    gets asked most, and answering it from the built server alone means
    reading the SDK's registry and guessing. This carries the answer.
    """

    server: MCPServer
    toolsets: frozenset[str]
    tools: tuple[ToolSpec, ...] = ()
    unknown: frozenset[str] = frozenset()

    @property
    def tool_names(self) -> tuple[str, ...]:
        return tuple(spec.name for spec in self.tools)


@dataclass
class McpHost:
    """A reactor platform, the MCP extensions on it, and the servers built.

    One host per process. It owns the platform, so an extension's activation
    events, enablement and disposal work the way they do for any other
    reactor plugin, and it caches a server per toolset selection, because
    building one means walking every contribution and wrapping every handler.
    """

    name: str = "reactor-mcp-server"
    instructions: str = ""
    platform: PluginPlatform = field(default_factory=PluginPlatform)
    _built: dict[str, BuiltServer] = field(default_factory=dict, init=False)
    _registered: set[str] = field(default_factory=set, init=False)

    # --- Extensions ----------------------------------------------------------

    def add(self, extension: McpExtension) -> str:
        """Register one extension. Answers the plugin name it registered as."""
        manifest = manifest_of(extension)
        if manifest.name in self._registered:
            logger.info("MCP extension '%s' is already registered", manifest.name)
            return manifest.name
        self.platform.register_plugin(manifest, extension)
        self._registered.add(manifest.name)
        # A server built before this extension arrived does not have its
        # tools, and a cached one would keep serving the old list.
        self._built.clear()
        return manifest.name

    def add_all(self, extensions: Iterable[McpExtension]) -> list[str]:
        return [self.add(extension) for extension in extensions]

    def start(self) -> None:
        self.platform.start()

    def stop(self) -> None:
        self.platform.stop()

    # --- What has been offered ----------------------------------------------

    def declared_toolsets(self) -> tuple[Toolset, ...]:
        """Every toolset the registered extensions declared."""
        return tuple(
            contribution.value
            for contribution in self.platform.get_contributions(TOOLSETS)
            if isinstance(contribution.value, Toolset)
        )

    def offered_tools(self, toolsets: Optional[Iterable[str]] = None) -> list[ToolSpec]:
        """The tools on offer, with every extension of them applied.

        Restricted to `toolsets` when one is given. A tool whose extension
        raises is left out rather than served half-extended: an extension that
        narrows a tool and fails to would otherwise widen it.
        """
        wanted = None if toolsets is None else set(toolsets)
        resolved: list[ToolSpec] = []
        for contribution in self.platform.get_contributions(TOOLS):
            spec = contribution.value
            if not isinstance(spec, ToolSpec):
                logger.error(
                    "Plugin %s contributed something that is not a tool: %r",
                    contribution.plugin,
                    spec,
                )
                continue
            if wanted is not None and spec.toolset not in wanted:
                continue
            extensions = [
                item.value
                for item in self.platform.get_contribution_extensions(TOOLS, spec.name)
            ]
            try:
                resolved.append(resolve(spec, extensions))
            except Exception:  # noqa: BLE001 - one bad extension, one lost tool
                logger.exception(
                    "Tool %s is not served: an extension of it failed", spec.name
                )
        return resolved

    # --- Building ------------------------------------------------------------

    def build(self, selection: Optional[Selection] = None) -> BuiltServer:
        """The server this selection asks for, built once and kept.

        Asking for a toolset is what activates the extensions that offer it:
        the event goes out before the contributions are read, so a plugin
        held back until somebody wanted it is registered, has contributed, and
        is in the list this call returns.
        """
        selection = selection or Selection()
        for name in selection.named | frozenset(selection.only or ()):
            self.platform.fire_event(on_toolset(name))

        declared = self.declared_toolsets()
        active = active_toolsets(declared, selection)
        key = activation_key(active)
        unknown = unknown_names(declared, selection)
        cached = self._built.get(key)
        if cached is not None:
            # The server is the same; what this particular URL got wrong is
            # not, and a cached "nothing unknown" would hide the stale name in
            # somebody's configuration for as long as the process lives.
            return cached if cached.unknown == unknown else replace(
                cached, unknown=unknown
            )

        specs = self.offered_tools(active)
        server = MCPServer(name=self.name, instructions=self.instructions or None)
        for spec in specs:
            server.add_tool(
                spec.handler,
                name=spec.name,
                title=spec.title or None,
                description=spec.documentation or None,
                annotations=spec.annotations,
            )
        for contribution in self.platform.get_contributions(RESOURCES):
            _apply(contribution.value, server, "resource", contribution.plugin)
        for contribution in self.platform.get_contributions(PROMPTS):
            _apply(contribution.value, server, "prompt", contribution.plugin)

        built = BuiltServer(
            server=server,
            toolsets=active,
            tools=tuple(specs),
            unknown=unknown,
        )
        self._built[key] = built
        logger.info(
            "MCP server built for toolsets [%s] with %d tools", key, len(specs)
        )
        return built

    def forget_built(self) -> None:
        """Drop the cached servers — after enabling or disabling a plugin."""
        self._built.clear()


def _apply(register: Any, server: MCPServer, what: str, plugin: str) -> None:
    if not callable(register):
        logger.error("Plugin %s contributed a %s that is not callable", plugin, what)
        return
    try:
        register(server)
    except Exception:  # noqa: BLE001 - one plugin never breaks the rest
        logger.exception("Plugin %s failed to register its %ss", plugin, what)


def build_host(
    extensions: Iterable[McpExtension],
    *,
    name: str = "reactor-mcp-server",
    instructions: str = "",
) -> McpHost:
    """A started host with these extensions on it."""
    host = McpHost(name=name, instructions=instructions)
    host.add_all(extensions)
    host.start()
    return host
