# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Toolsets, and which of them a URL asks for.

A hosted MCP server serves one endpoint to everybody, and not everybody wants
the same tools: a client that came for notebooks should not have to read past
twenty tools it will never call, and a model given every tool a deployment can
offer chooses worse than one given the tools for the job.

So tools belong to named toolsets, and the URL says which ones this client
wants::

    https://mcp.datalayer.run/mcp            the default toolsets
    https://mcp.datalayer.run/mcp?benchmarks the default ones and benchmarks
    https://mcp.datalayer.run/mcp?contents,library the defaults and both named sets
    https://mcp.datalayer.run/mcp?only=spaces only spaces (and the always-on)

A bare flag is the spelling worth having: it is what somebody types into an
agent's configuration, and `?benchmarks` says what it means without anybody
reading a manual. `toolsets=` exists for the case a query string is built by
something that wants a value, and `only=` for a client that wants exactly a
set — an evaluation harness pinning what a run may reach.

@module reactor_mcp_server.toolsets
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, Mapping
from urllib.parse import parse_qsl

#: The query keys with a meaning of their own; anything else is a toolset name.
TOOLSETS_KEY = "toolsets"
ONLY_KEY = "only"
WITHOUT_KEY = "without"


@dataclass(frozen=True)
class Toolset:
    """A named group of tools, as an extension declares it."""

    name: str
    description: str = ""
    #: On when the URL says nothing. An opt-in toolset sets this to `False`
    #: and is served only to a client that asks for it by name.
    default: bool = True
    #: On whatever the URL says. For the tools a server is not a server
    #: without — the ones every client needs before it can ask for anything
    #: else — so `only=` cannot produce an endpoint nobody can use.
    always: bool = False

    def __post_init__(self) -> None:
        if not self.name:
            raise ValueError("A toolset needs a name")


@dataclass(frozen=True)
class Selection:
    """What one URL asked for, before it is matched against what exists."""

    #: Named in addition to the defaults.
    named: frozenset[str] = frozenset()
    #: Named as the whole of it, `None` when the URL did not say.
    only: frozenset[str] | None = None
    #: Named to be left out, even if they are on by default.
    without: frozenset[str] = frozenset()

    @property
    def is_empty(self) -> bool:
        """Whether the URL asked for nothing at all."""
        return not self.named and self.only is None and not self.without


def _names(value: str) -> list[str]:
    return [part.strip() for part in value.replace(" ", ",").split(",") if part.strip()]


def parse_selection(query: str | None) -> Selection:
    """Read a query string as a toolset selection.

    Unknown keys are toolset names, which is what makes `?benchmarks` work;
    a key with a value that is not one of the three reserved ones is read as
    a name too, so `?benchmarks=1` does what somebody who typed it meant.
    """
    named: set[str] = set()
    only: set[str] | None = None
    without: set[str] = set()
    for key, value in parse_qsl(query or "", keep_blank_values=True):
        key = key.strip()
        if not key:
            continue
        if key == TOOLSETS_KEY:
            named.update(_names(value))
        elif key == ONLY_KEY:
            only = (only or set()) | set(_names(value))
        elif key == WITHOUT_KEY:
            without.update(_names(value))
        else:
            # A bare comma-separated list is the compact spelling used in
            # client configuration: ``?contents,library``.  Query parsers see
            # it as one key with an empty value, so split it by the same rules
            # as ``toolsets=contents,library`` rather than treating the comma as
            # part of a toolset's name.
            named.update(_names(key))
    return Selection(
        named=frozenset(named),
        only=None if only is None else frozenset(only),
        without=frozenset(without),
    )


def active_toolsets(
    declared: Iterable[Toolset], selection: Selection
) -> frozenset[str]:
    """Which toolsets this selection turns on, out of the declared ones.

    A name nobody declared is not an error here. A URL is written by a person
    configuring an agent, and a deployment that refused the whole connection
    over a stale toolset name would take a working client down over a typo;
    the host reports unknown names (:func:`unknown_names`) so a client can be
    told, and serves what it does have.
    """
    by_name = {toolset.name: toolset for toolset in declared}
    always = {name for name, toolset in by_name.items() if toolset.always}

    if selection.only is not None:
        chosen = {name for name in selection.only if name in by_name} | always
    else:
        chosen = {
            name for name, toolset in by_name.items() if toolset.default
        } | {name for name in selection.named if name in by_name} | always

    return frozenset(chosen - (selection.without - always))


def unknown_names(declared: Iterable[Toolset], selection: Selection) -> frozenset[str]:
    """Names the URL used that no extension declared."""
    known = {toolset.name for toolset in declared}
    asked = set(selection.named) | set(selection.only or ()) | set(selection.without)
    return frozenset(asked - known)


def activation_key(active: Iterable[str]) -> str:
    """A stable key for a set of toolsets.

    Two clients asking for the same toolsets in a different order are the same
    server, built once and shared. This is what that sameness is keyed on.
    """
    return ",".join(sorted(set(active)))


def selection_from_scope(scope: Mapping[str, object]) -> Selection:
    """The selection an ASGI scope's query string carries."""
    raw = scope.get("query_string") or b""
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", "replace")
    return parse_selection(str(raw))
