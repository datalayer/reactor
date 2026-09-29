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
    #: Put `list_server_toolsets` on every built server: the answer `/toolsets`
    #: gives over HTTP, as a tool — for a model that should find out, in the
    #: conversation, which toolset to ask for, and for a stdio client that has
    #: no route to read. Off by default, so a deployment's tool list does not
    #: grow a tool it did not choose.
    toolsets_tool: bool = False
    #: One built server per (tenant, toolsets); a tenant sees its own.
    _built: dict[tuple[Optional[str], str], BuiltServer] = field(
        default_factory=dict, init=False
    )
    #: Bumped whenever a built server may be stale — an extension added, the
    #: cache dropped — so whatever holds an application made from one (the
    #: router) knows to make it again.
    revision: int = field(default=0, init=False)
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
        self.revision += 1
        return manifest.name

    def add_all(self, extensions: Iterable[McpExtension]) -> list[str]:
        return [self.add(extension) for extension in extensions]

    def start(self) -> None:
        self.platform.start()

    def stop(self) -> None:
        self.platform.stop()

    # --- What has been offered ----------------------------------------------

    def declared_toolsets(self, tenant_id: Optional[str] = None) -> tuple[Toolset, ...]:
        """Every toolset the registered extensions declared, once each.

        A name is a subject, not a plugin: two extensions that add to the
        same one declare the same name, which is how a deployment puts its
        own sandbox tools in `sandboxes` beside the ones that ship. So the
        *name* is what identifies a toolset here, and the first declaration
        of it is the one described — anything else lists it twice, with two
        descriptions, to a client that asked what there is.

        An extension held back until somebody asks for its toolset has not
        contributed yet, but it has *declared*: its declarations are read
        from the extension itself, without waking it, so `/toolsets` can name
        the very toolset a client has to put in its URL.
        """
        seen: dict[str, Toolset] = {}
        for contribution in self.platform.get_contributions(TOOLSETS, tenant_id=tenant_id):
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
        allowed = (
            None if tenant_id is None else set(self.platform.resolve_tenant_plugins(tenant_id))
        )
        for name, extension in self._registered.items():
            if allowed is not None and name not in allowed:
                continue
            for toolset in extension.toolsets():
                if isinstance(toolset, Toolset) and toolset.name not in seen:
                    seen[toolset.name] = toolset
        return tuple(seen.values())

    def offered_tools(
        self,
        toolsets: Optional[Iterable[str]] = None,
        tenant_id: Optional[str] = None,
    ) -> list[ToolSpec]:
        """The tools on offer, with every extension of them applied.

        Restricted to `toolsets` when one is given, and to what `tenant_id`
        may use when one is given. A tool whose extension raises is left out
        rather than served half-extended: an extension that narrows a tool
        and fails to would otherwise widen it.
        """
        wanted = None if toolsets is None else set(toolsets)
        resolved: list[ToolSpec] = []
        for contribution in self.platform.get_contributions(TOOLS, tenant_id=tenant_id):
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
                for item in self.platform.get_contribution_extensions(
                    TOOLS, spec.name, tenant_id=tenant_id
                )
            ]
            try:
                resolved.append(resolve(spec, extensions))
            except Exception:  # noqa: BLE001 - one bad extension, one lost tool
                logger.exception(
                    "Tool %s is not served: an extension of it failed", spec.name
                )
        return resolved

    # --- Which toolsets -------------------------------------------------------

    def active_for(
        self,
        selection: Optional[Selection] = None,
        tenant_id: Optional[str] = None,
    ) -> frozenset[str]:
        """The toolsets a selection turns on, without building a server.

        For whatever sits beside the MCP application and has to know what a
        request is about to get — a middleware that fetches credentials only
        for a request that selects the toolset needing them. Asking whether a
        name was *in the URL* is not the same question: ``?only=odoo`` never
        names it the way ``?odoo`` does, a default toolset is on without being
        named, and ``without=`` takes one away.
        """
        return active_toolsets(self.declared_toolsets(tenant_id), selection or Selection())

    def instructions_for(
        self, active: Iterable[str], tenant_id: Optional[str] = None
    ) -> str:
        """The host's instructions, and those of every active toolset.

        A toolset's instructions reach a client only when it is active, so a
        client that did not ask for a toolset does not read how to use it.
        """
        wanted = set(active)
        parts = [self.instructions] if self.instructions else []
        for toolset in sorted(self.declared_toolsets(tenant_id), key=lambda item: item.name):
            if toolset.name in wanted and toolset.instructions:
                parts.append(f"## {toolset.title or toolset.name}\n\n{toolset.instructions}")
        return "\n\n".join(parts)

    def describe(
        self,
        selection: Optional[Selection] = None,
        tenant_id: Optional[str] = None,
    ) -> dict[str, Any]:
        """What this host offers, and what a selection gets of it.

        One answer, served two ways: at ``/toolsets`` over HTTP, and by the
        ``list_server_toolsets`` tool to a client already in a session.
        """
        built = self.build(selection, tenant_id=tenant_id)
        return _description(
            self.declared_toolsets(tenant_id),
            built.toolsets,
            built.tool_names,
            built.unknown,
        )

    # --- Building ------------------------------------------------------------

    def build(
        self,
        selection: Optional[Selection] = None,
        tenant_id: Optional[str] = None,
    ) -> BuiltServer:
        """The server this selection asks for, built once and kept.

        Asking for a toolset is what activates the extensions that offer it:
        the event goes out before the contributions are read, so a plugin
        held back until somebody wanted it is registered, has contributed, and
        is in the list this call returns.

        With a `tenant_id`, only what that tenant may use is read, and the
        server is cached for that tenant: two tenants never share one.
        """
        selection = selection or Selection()
        changed = False
        for name in selection.named | frozenset(selection.only or ()):
            fired = self.platform.fire_event(on_toolset(name))
            changed = changed or bool(fired.get("activated") or fired.get("deactivated"))
        if changed:
            # A plugin woken or stood down changes what is offered — it may
            # extend a tool of a toolset already built, or retire one — so no
            # server built before it may be served again. The router follows
            # `revision` and makes new applications for new connections.
            self.forget_built()

        declared = self.declared_toolsets(tenant_id)
        active = active_toolsets(declared, selection)
        key = activation_key(active)
        unknown = unknown_names(declared, selection)
        cached = self._built.get((tenant_id, key))
        if cached is not None:
            # The server is the same; what this particular URL got wrong is
            # not, and a cached "nothing unknown" would hide the stale name in
            # somebody's configuration for as long as the process lives.
            return cached if cached.unknown == unknown else replace(
                cached, unknown=unknown
            )

        specs = self.offered_tools(active, tenant_id)
        participating = self._participating(active, tenant_id)
        if self.toolsets_tool:
            if any(spec.name == LIST_SERVER_TOOLSETS for spec in specs):
                # An extension offers a tool by that name: its tool is served,
                # not shadowed by the host's.
                logger.warning(
                    "An extension offers %s; the host's is not added", LIST_SERVER_TOOLSETS
                )
            else:
                names = (*(spec.name for spec in specs), LIST_SERVER_TOOLSETS)
                specs = [*specs, _list_server_toolsets_spec(self, active, names, tenant_id)]
        server = self.server_factory(
            self.name, self.instructions_for(active, tenant_id) or None
        )
        put_on_server(server, specs)
        # Resources, prompts and `on_server` belong to the selection the way
        # tools do: an extension whose toolset is not active — or that was
        # woken by some other client's URL — puts nothing on this server.
        for contribution in self.platform.get_contributions(RESOURCES, tenant_id=tenant_id):
            if contribution.plugin in participating:
                _apply(contribution.value, server, "resource", contribution.plugin)
        for contribution in self.platform.get_contributions(PROMPTS, tenant_id=tenant_id):
            if contribution.plugin in participating:
                _apply(contribution.value, server, "prompt", contribution.plugin)
        # Last, so an extension acting on the server sees everything that was
        # offered — including what other extensions offered.
        for name, extension in self._registered.items():
            if name not in participating:
                continue
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
        self._built[(tenant_id, key)] = built
        logger.info(
            "MCP server built for toolsets [%s] with %d tools", key, len(specs)
        )
        return built

    def _participating(
        self, active: frozenset[str], tenant_id: Optional[str]
    ) -> set[str]:
        """The plugins that are part of a selection: the ones that declared an
        active toolset or contributed a tool in one."""
        names: set[str] = set()
        for contribution in self.platform.get_contributions(TOOLSETS, tenant_id=tenant_id):
            toolset = contribution.value
            if isinstance(toolset, Toolset) and toolset.name in active:
                names.add(contribution.plugin)
        for contribution in self.platform.get_contributions(TOOLS, tenant_id=tenant_id):
            spec = contribution.value
            if isinstance(spec, ToolSpec) and spec.toolset in active:
                names.add(contribution.plugin)
        return names

    def forget_built(self) -> None:
        """Drop the cached servers — after enabling or disabling a plugin."""
        self._built.clear()
        self.revision += 1


#: The name of the tool `toolsets_tool` puts on a server.
LIST_SERVER_TOOLSETS = "list_server_toolsets"


def _description(
    declared: Iterable[Toolset],
    active: Iterable[str],
    tools: Iterable[str],
    unknown: Iterable[str] = (),
) -> dict[str, Any]:
    on = set(active)
    return {
        "toolsets": [
            {
                "name": toolset.name,
                "title": toolset.title or toolset.name,
                "description": toolset.description,
                "default": toolset.default,
                "always": toolset.always,
                "active": toolset.name in on,
            }
            for toolset in sorted(declared, key=lambda item: item.name)
        ],
        "active": sorted(on),
        "tools": sorted(tools),
        "unknown": sorted(unknown),
    }


def _list_server_toolsets_spec(
    host: "McpHost",
    active: frozenset[str],
    tools: tuple[str, ...],
    tenant_id: Optional[str],
) -> ToolSpec:
    from mcp.types import ToolAnnotations  # noqa: PLC0415

    async def list_server_toolsets() -> dict[str, Any]:
        """List the toolsets this server offers, and which ones this session has.

        A toolset that is not active is reached by reconnecting with its name
        in the server URL: `?name` adds it to the defaults, `?only=a,b` asks
        for exactly those, `?without=name` leaves a default one out.
        """
        answer = _description(host.declared_toolsets(tenant_id), active, tools)
        answer["how_to_select"] = (
            "Reconnect with the toolset in the URL: ?name adds it, "
            "?only=a,b asks for exactly those, ?without=name leaves one out."
        )
        return answer

    return ToolSpec(
        name=LIST_SERVER_TOOLSETS,
        handler=list_server_toolsets,
        title="List Server Toolsets",
        annotations=ToolAnnotations(
            title="List Server Toolsets",
            read_only_hint=True,
            destructive_hint=False,
            idempotent_hint=True,
            open_world_hint=False,
        ),
    )


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
    toolsets_tool: bool = False,
) -> McpHost:
    """A started host with these extensions on it.

    `server_factory` is how each selection's server is made — a deployment
    serving a subclass of `MCPServer` names it here. `toolsets_tool`
    puts `list_server_toolsets` on every server built.
    """
    host = McpHost(
        name=name, instructions=instructions, toolsets_tool=toolsets_tool
    )
    if server_factory is not None:
        host.server_factory = server_factory
    host.add_all(extensions)
    host.start()
    return host
