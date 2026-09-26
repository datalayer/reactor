# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""What an extension offers, and what another extension may do to it.

A tool is a contribution. That is the whole idea: an extension does not reach
into a server object and register a function on it, it *offers* a
:class:`ToolSpec` at a contribution point, and the host builds a server from
what has been offered. Offering rather than registering is what makes the next
part possible.

The next part is that a tool one extension offers can be **extended** by
another. Before this, an extension that wanted to narrow somebody else's tool
had exactly one lever — register a tool of the same name and hope to run
second, because the SDK keeps the first registration — so the result depended
on the order two distributions happened to load in. It worked where the entry
point names sorted the right way and silently did nothing where they did not.
A :class:`ToolExtension` says what it does to which tool, and the host applies
them in a declared order.

@module reactor_mcp_server.tools
"""

from __future__ import annotations

import inspect
from dataclasses import dataclass, field, replace
from typing import Any, Callable, Iterable, Optional

#: A tool's implementation. Sync or async — the MCP SDK takes either.
Handler = Callable[..., Any]

#: What an extension does to a handler: takes it, answers another one.
Wrapper = Callable[[Handler], Handler]


@dataclass(frozen=True)
class ToolSpec:
    """One tool, as an extension offers it."""

    #: What a client calls it. Unique across the server it is built into.
    name: str
    handler: Handler
    #: What a model reads to decide whether to call it. Falls back to the
    #: handler's docstring, so the description and the code cannot drift.
    description: str = ""
    title: str = ""
    #: `mcp.types.ToolAnnotations`, left untyped so this module does not make
    #: every caller import the SDK to offer a tool without annotations.
    annotations: Any = None
    #: The toolset this tool belongs to. Empty means the extension's own name,
    #: filled in by the host when the tool is contributed.
    toolset: str = ""
    #: Anything the host should carry but not interpret — a policy, a scope.
    meta: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if not self.name:
            raise ValueError("A tool needs a name")
        if not callable(self.handler):
            raise ValueError(f"Tool {self.name} has no callable handler")

    @property
    def documentation(self) -> str:
        """What the server should publish as this tool's description."""
        if self.description:
            return self.description
        return inspect.cleandoc(self.handler.__doc__ or "")


@dataclass(frozen=True)
class ToolExtension:
    """What one extension does to another extension's tool.

    Three things, and nothing else, because a fourth would be the extension
    replacing the tool rather than extending it:

    * ``wrap`` takes the handler and answers another one — the way to add a
      check before, a shape after, or an argument the wrapper fills in;
    * ``description`` and ``title`` replace what a model reads, for an
      extension that narrows a tool and should say so;
    * ``annotations`` replace the tool's, for a deployment where the same
      tool is, say, no longer read-only.

    An extension of a tool nobody offered is not an error: it is stored, never
    applies, and the host says so when asked. An extension that is installed
    before the thing it extends is an ordinary state, not a failure.
    """

    wrap: Optional[Wrapper] = None
    description: Optional[str] = None
    title: Optional[str] = None
    annotations: Any = None
    #: Merged over the tool's own, so an extension can carry a policy the host
    #: reads without the tool having to know the extension exists.
    meta: dict[str, Any] = field(default_factory=dict)

    def apply(self, spec: ToolSpec) -> ToolSpec:
        """This extension, applied to a tool."""
        changes: dict[str, Any] = {}
        if self.wrap is not None:
            handler = self.wrap(spec.handler)
            if not callable(handler):
                raise ValueError(
                    f"An extension of {spec.name} answered something that is "
                    "not callable; `wrap` takes a handler and returns a handler"
                )
            changes["handler"] = handler
            if self.description is None and not spec.description:
                # The description was the handler's docstring; the wrapper
                # rarely has one, and an unset field keeps the original.
                changes["description"] = spec.documentation
        if self.description is not None:
            changes["description"] = self.description
        if self.title is not None:
            changes["title"] = self.title
        if self.annotations is not None:
            changes["annotations"] = self.annotations
        if self.meta:
            changes["meta"] = {**spec.meta, **self.meta}
        return replace(spec, **changes) if changes else spec


def tool(
    name: str = "",
    *,
    description: str = "",
    title: str = "",
    annotations: Any = None,
    toolset: str = "",
    meta: Optional[dict[str, Any]] = None,
) -> Callable[[Handler], Handler]:
    """Mark a function as a tool this extension offers.

    The function is returned unchanged and stays callable — a tool is an
    ordinary function that something else decided to publish, and a test
    should be able to call it without a server::

        @tool(title="Launch Sandbox")
        async def launch_sandbox(sandbox_name: str) -> dict:
            \"\"\"Launch a sandbox for this session to run code in.\"\"\"

    The spec is attached to the function, and
    :meth:`~reactor_mcp_server.extension.McpExtension.tools` collects it.
    """

    def decorate(handler: Handler) -> Handler:
        spec = ToolSpec(
            name=name or handler.__name__,
            handler=handler,
            description=description,
            title=title,
            annotations=annotations,
            toolset=toolset,
            meta=dict(meta or {}),
        )
        setattr(handler, "__mcp_tool__", spec)
        return handler

    return decorate


def tool_spec_of(candidate: Any) -> Optional[ToolSpec]:
    """The spec `@tool` attached to this object, if it is one."""
    spec = getattr(candidate, "__mcp_tool__", None)
    return spec if isinstance(spec, ToolSpec) else None


def resolve(spec: ToolSpec, extensions: Iterable[ToolExtension]) -> ToolSpec:
    """A tool with every extension of it applied, in the order given.

    The order is the host's: contributions come back ordered by their declared
    ``order`` and then by the order they were contributed, so two extensions of
    the same tool compose the same way on every machine. The outermost wrapper
    is the last one applied, which is what an extension adding a check expects
    — it runs first, and the tool it guards runs last.
    """
    resolved = spec
    for extension in extensions:
        if not isinstance(extension, ToolExtension):
            raise ValueError(
                f"{extension!r} extends {spec.name} but is not a ToolExtension"
            )
        resolved = extension.apply(resolved)
    return resolved
