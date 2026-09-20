# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""What an MCP extension is.

A reactor plugin that offers tools. It declares itself with a
:class:`~reactor.PluginManifest`, like every other plugin, and it offers its
tools, toolsets, resources and prompts through
:meth:`~reactor.PluginContributions.contribute` — which the base class does
for it, from what the subclass declares.

Declaring rather than registering is the point. A subclass says *what* it
offers; when the tools are put on a server, which server, and whether they are
put on at all, is the host's business — and that is what lets the same
extension serve a client that asked for its toolset and be absent for one that
did not, without the extension knowing either happened.

@module reactor_mcp_server.extension
"""

from __future__ import annotations

import inspect
import logging
from dataclasses import replace
from typing import Any, Iterable, Sequence

from reactor import PluginContributions, PluginManifest

from reactor_mcp_server.points import PROMPTS, RESOURCES, TOOLS, TOOLSETS
from reactor_mcp_server.tools import ToolExtension, ToolSpec, tool_spec_of
from reactor_mcp_server.toolsets import Toolset

logger = logging.getLogger(__name__)


class McpExtension:
    """Base class for an extension of an MCP server.

    Subclasses override what they offer. Everything has a default, so an
    extension that only adds two tools writes only :meth:`tools`.
    """

    def manifest(self) -> PluginManifest:
        """What this extension says about itself before anything runs it."""
        raise NotImplementedError(
            f"{type(self).__name__} must describe itself with a PluginManifest"
        )

    # --- What it offers ------------------------------------------------------

    def tools(self) -> Sequence[ToolSpec]:
        """The tools this extension offers.

        The default collects every method the :func:`~reactor_mcp_server.tools.tool`
        decorator marked, so the usual extension writes tools and nothing else.
        """
        found: list[ToolSpec] = []
        for _, member in inspect.getmembers(self, callable):
            spec = tool_spec_of(member)
            if spec is not None:
                # Bound, so the handler is the method with `self` applied and a
                # tool can use the extension's own state.
                found.append(replace(spec, handler=member))
        return sorted(found, key=lambda spec: spec.name)

    def tool_extensions(self) -> Sequence[tuple[str, ToolExtension]]:
        """What this extension does to *other* extensions' tools.

        Pairs of the tool's name and the extension of it. The tool need not
        exist: an extension of an absent tool never applies, which is the
        right behaviour for a deployment where the thing being extended is
        simply not installed.
        """
        return ()

    def toolsets(self) -> Sequence[Toolset]:
        """The toolsets this extension declares.

        The default is one toolset named after the plugin, on by default — so
        an extension that says nothing is served to everybody, and an
        extension that wants to be opt-in says so once, here.
        """
        return (Toolset(name=self.manifest().name),)

    def resources(self) -> Sequence[Any]:
        """Callables that register MCP resources on a server."""
        return ()

    def prompts(self) -> Sequence[Any]:
        """Callables that register MCP prompts on a server."""
        return ()

    def on_server(self, server: Any) -> None:
        """Act on a server once its tools are on it.

        The escape hatch, and deliberately a narrow one. Everything an
        extension *offers* goes through the contribution points above, where a
        host can read it without running anything. This is for what an
        extension has to do **to** a built server: take off a tool the host
        registered outside the contribution model, add something the SDK
        exposes and a spec does not describe.

        Called once per built server, after the tools, resources and prompts
        are on it, in contribution order. A server is built per set of
        toolsets, so an extension whose toolset is not active is not called.
        """

    # --- Lifecycle -----------------------------------------------------------

    def on_start(self) -> None:
        """Called when the platform starts."""

    def on_stop(self) -> None:
        """Called when the platform stops. Release resources here."""

    # --- Reactor plugin protocol --------------------------------------------

    def provide_contributions(self, contributions: PluginContributions) -> None:
        """Offer everything this extension has, as this plugin.

        Each tool is contributed under its own **name**, which is what lets
        another extension extend it by name. A tool that named no toolset is
        put in this extension's own, so every tool is in exactly one and
        nothing falls outside the URL's reach.
        """
        declared = list(self.toolsets())
        # A tool that named no toolset goes in this extension's **first
        # declared** one, not in one named after the plugin: an extension that
        # declares `sandboxes` and is called `sandboxes-datalayer` would
        # otherwise put its tools in a toolset nobody declared, and a toolset
        # nobody declared is never active — the tools would be contributed,
        # filtered out, and absent with nothing saying why.
        default_toolset = declared[0].name if declared else self.manifest().name
        for toolset in declared:
            contributions.contribute(
                TOOLSETS, toolset, contribution_id=toolset.name
            )
        for spec in self.tools():
            placed = spec if spec.toolset else replace(spec, toolset=default_toolset)
            contributions.contribute(TOOLS, placed, contribution_id=placed.name)
        for target, extension in self.tool_extensions():
            contributions.extend(TOOLS, target, extension)
        for register in self.resources():
            contributions.contribute(RESOURCES, register)
        for register in self.prompts():
            contributions.contribute(PROMPTS, register)


def manifest_of(extension: McpExtension) -> PluginManifest:
    """An extension's manifest, with the points it uses declared on it.

    A host drawing the plugin graph should see that this plugin speaks MCP
    without having to run it, and the manifest is what it reads.
    """
    manifest = extension.manifest()
    points = list(
        dict.fromkeys([*manifest.contribution_points, TOOLS.id, TOOLSETS.id])
    )
    return replace(manifest, contribution_points=points)


def load_extensions(names: Iterable[str] | None = None) -> list[McpExtension]:
    """Every MCP extension installed, or only the ones named.

    Sorted by entry-point name, so a server built twice on the same machines
    is built the same way. Order is not what decides whether one extension can
    extend another's tool any more — that is what
    :meth:`McpExtension.tool_extensions` is for — but a stable order is still
    what makes two runs comparable.

    One extension failing to load costs that extension, not the server: a
    deployment with a broken plugin serves the rest and says which one it
    lost.
    """
    from importlib import metadata  # noqa: PLC0415

    from reactor_mcp_server.points import ENTRY_POINT_GROUP  # noqa: PLC0415

    wanted = {name for name in (names or ()) if name}
    found: list[McpExtension] = []
    try:
        entry_points = metadata.entry_points(group=ENTRY_POINT_GROUP)
    except TypeError:  # pragma: no cover - Python < 3.10
        entry_points = metadata.entry_points().get(ENTRY_POINT_GROUP, [])
    for entry_point in sorted(entry_points, key=lambda point: point.name):
        if wanted and entry_point.name not in wanted:
            continue
        try:
            factory = entry_point.load()
            extension = factory() if callable(factory) else factory
        except Exception:  # noqa: BLE001 - one plugin never breaks the rest
            logger.exception("MCP extension '%s' could not be loaded", entry_point.name)
            continue
        if not isinstance(extension, McpExtension):
            logger.error(
                "MCP extension '%s' is not an McpExtension: %r",
                entry_point.name,
                extension,
            )
            continue
        found.append(extension)
    return found
