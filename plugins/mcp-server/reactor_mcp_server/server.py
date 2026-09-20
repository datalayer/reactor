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
from typing import Any, Callable, Iterable, Optional

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
    #: How a server is made, given this host's name and instructions.
    #:
    #: A host that serves over HTTP usually needs more than a bare
    #: `MCPServer` — a subclass carrying CORS, an authentication middleware,
    #: a token verifier the deployment configured. A selection is served by
    #: the server built for it, so that subclass has to be what `build`
    #: makes, not something wrapped around it afterwards.
    server_factory: Callable[[str, Optional[str]], MCPServer] = field(
        default=lambda name, instructions: MCPServer(
            name=name, instructions=instructions
        )
    )
    _built: dict[str, BuiltServer] = field(default_factory=dict, init=False)
    #: The extensions by the name they registered as — for `on_server`, which
    #: needs the instance rather than the contributions it made.
    _registered: dict[str, McpExtension] = field(default_factory=dict, init=False)

    # --- Extensions ----------------------------------------------------------

    def add(self, extension: McpExtension) -> str:
        """Register one extension. Answers the plugin name it registered as."""
        manifest = manifest_of(extension)
        if manifest.name in self._registered:
            logger.info("MCP extension '%s' is already registered", manifest.name)
            return manifest.name
        self.platform.register_plugin(manifest, extension)
        self._registered[manifest.name] = extension
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
        """Every toolset the registered extensions declared, once each.

        A name is a subject, not a plugin: two extensions that add to the
        same one declare the same name, which is how a deployment puts its
        own sandbox tools in `sandboxes` beside the ones that ship. So the
        *name* is what identifies a toolset here, and the first declaration
        of it is the one described — anything else lists it twice, with two
        descriptions, to a client that asked what there is.
        """
        seen: dict[str, Toolset] = {}
        for contribution in self.platform.get_contributions(TOOLSETS):
            toolset = contribution.value
            if not isinstance(toolset, Toolset):
                continue
            if toolset.name in seen:
                logger.debug(
                    "Plugin %s also declares the '%s' toolset; the first "
                    "declaration is the one described",
                    contribution.plugin,
                    toolset.name,
                )
                continue
            seen[toolset.name] = toolset
        return tuple(seen.values())

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
        server = self.server_factory(self.name, self.instructions or None)
        put_on_server(server, specs)
        for contribution in self.platform.get_contributions(RESOURCES):
            _apply(contribution.value, server, "resource", contribution.plugin)
        for contribution in self.platform.get_contributions(PROMPTS):
            _apply(contribution.value, server, "prompt", contribution.plugin)
        # Last, so an extension acting on the server sees everything that was
        # offered — including what other extensions offered.
        for name, extension in self._registered.items():
            act = getattr(extension, "on_server", None)
            if act is None:
                continue
            try:
                act(server)
            except Exception:  # noqa: BLE001 - one plugin never breaks the rest
                logger.exception("Plugin %s failed acting on the server", name)

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


def put_on_server(server: MCPServer, specs: Iterable[ToolSpec]) -> MCPServer:
    """Put tools on a server, the way the host does.

    The host's own step, exported: a caller assembling a server by hand — a
    test, a script, a deployment that builds one server and keeps it — should
    put a tool on it the same way, or the thing it exercises is not the thing
    that is served.
    """
    for spec in specs:
        server.add_tool(
            spec.handler,
            name=spec.name,
            title=spec.title or None,
            description=spec.documentation or None,
            annotations=spec.annotations,
        )
    return server


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
    server_factory: Optional[Callable[[str, Optional[str]], MCPServer]] = None,
) -> McpHost:
    """A started host with these extensions on it.

    `server_factory` is how each selection's server is made — a deployment
    serving a subclass of `MCPServer` names it here.
    """
    host = McpHost(name=name, instructions=instructions)
    if server_factory is not None:
        host.server_factory = server_factory
    host.add_all(extensions)
    host.start()
    return host
