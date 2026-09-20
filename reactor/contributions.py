# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Contribution points and contributions, on the Python side.

The TypeScript runtime grew these first, and the two halves of the reactor
should not disagree about what a plugin *is*. A hook answers "call every
plugin when this happens". A contribution point answers a different question:
"what do plugins offer, so the host can choose?" — the views a workspace may
open, the commands a session may run, the panels an application may show.

The shape mirrors ``@datalayer/reactor``: a typed point, contributions ordered
by ``order`` and then by contribution order, an identity per contribution so a
host can activate one among many, and disposal tied to the plugin that
contributed.

One thing the TypeScript side has no equivalent for: **tenants**. This platform
enables plugins per tenant, so contributions are read through that filter —
what a tenant may see is decided where enablement already lives, not by each
caller remembering to check.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Generic, Iterable, Optional, TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")

#: Undoes one contribution. Idempotent.
Dispose = Callable[[], None]


@dataclass(frozen=True)
class ContributionPoint(Generic[T]):
    """A named, typed contribution point.

    The type parameter types the contributions; at runtime a point is its id.
    """

    id: str


def define_contribution_point(point_id: str) -> ContributionPoint[Any]:
    """Declare a contribution point.

    ::

        VIEW_TYPE = define_contribution_point("app.viewType")
    """
    if not point_id:
        raise ValueError("A contribution point needs an id")
    return ContributionPoint(id=point_id)


def extension_point(point: ContributionPoint[T], target_id: str) -> ContributionPoint[Any]:
    """The point that holds *extensions of* one contribution.

    A plugin offers something — a view, a command, a tool — and another plugin
    wants to add to that particular one rather than offer a rival. Without
    this, the second plugin's only lever is to contribute a replacement and
    hope it is read last, which makes the outcome depend on load order: the
    thing works on the machine where the names happen to sort the right way.

    An extension is an ordinary contribution to a derived point, so everything
    the registry already does — order, identity, tenant filtering, disposal
    with the plugin — holds for extensions too, and a host can read them
    without a second mechanism::

        TOOLS = define_contribution_point("mcp.tools")
        contributions.extend(TOOLS, "launch_sandbox", narrowing)
        registry.extensions_of(TOOLS, "launch_sandbox")

    The target need not exist. A plugin that extends a tool nobody
    contributed has done nothing wrong — the extension simply never applies —
    and that is the same shape as declaring a dependency on an extension that
    is not installed.
    """
    if not target_id:
        raise ValueError("An extension needs the id of what it extends")
    return ContributionPoint(id=f"{point.id}::{target_id}")


@dataclass(frozen=True)
class Contribution(Generic[T]):
    """A stored contribution, as handed back to the host."""

    #: Name of the plugin that contributed it — for hosts, and for debugging.
    plugin: str
    #: Identity within the point, for hosts that activate one among many.
    id: str
    order: int
    value: T


@dataclass(order=True)
class _Stored:
    order: int
    seq: int
    plugin: str = field(compare=False)
    contribution_id: str = field(compare=False)
    value: Any = field(compare=False)


class ContributionRegistry:
    """Everything plugins have contributed, by point."""

    def __init__(self) -> None:
        self._by_point: dict[str, list[_Stored]] = {}
        self._seq = 0

    def add(
        self,
        plugin_name: str,
        point: ContributionPoint[T],
        value: T,
        *,
        contribution_id: Optional[str] = None,
        order: int = 0,
    ) -> Dispose:
        """Store a contribution and return its disposer."""
        entry = _Stored(
            order=order,
            seq=self._seq,
            plugin=plugin_name,
            contribution_id=contribution_id or plugin_name,
            value=value,
        )
        self._seq += 1
        self._by_point.setdefault(point.id, []).append(entry)

        disposed = False

        def dispose() -> None:
            nonlocal disposed
            if disposed:
                return
            disposed = True
            entries = self._by_point.get(point.id)
            if entries and entry in entries:
                entries.remove(entry)
            if entries is not None and not entries:
                self._by_point.pop(point.id, None)

        return dispose

    def get(
        self,
        point: ContributionPoint[T],
        *,
        plugins: Optional[Iterable[str]] = None,
    ) -> list[Contribution[T]]:
        """Contributions for a point, ordered by ``order`` then contribution order.

        ``plugins`` restricts the result to a set of plugin names — how the
        platform applies enablement and tenant scoping.
        """
        entries = self._by_point.get(point.id, [])
        allowed = set(plugins) if plugins is not None else None
        return [
            Contribution(
                plugin=entry.plugin,
                id=entry.contribution_id,
                order=entry.order,
                value=entry.value,
            )
            for entry in sorted(entries)
            if allowed is None or entry.plugin in allowed
        ]

    def extensions_of(
        self,
        point: ContributionPoint[T],
        target_id: str,
        *,
        plugins: Optional[Iterable[str]] = None,
    ) -> list[Contribution[Any]]:
        """What plugins contributed *to* one contribution of a point.

        Ordered like any other point, so a host applies them in a defined
        order rather than the order the plugins happened to load in.
        """
        return self.get(extension_point(point, target_id), plugins=plugins)

    def dispose_plugin(self, plugin_name: str) -> int:
        """Drop everything one plugin contributed. Returns how many went."""
        removed = 0
        for point_id in list(self._by_point):
            entries = self._by_point[point_id]
            kept = [entry for entry in entries if entry.plugin != plugin_name]
            removed += len(entries) - len(kept)
            if kept:
                self._by_point[point_id] = kept
            else:
                del self._by_point[point_id]
        return removed

    def points(self) -> tuple[str, ...]:
        """Ids of the points that currently hold something."""
        return tuple(sorted(self._by_point))


class PluginContributions:
    """The registry as one plugin sees it.

    A plugin is handed this rather than the registry itself, so it contributes
    *as itself*: the name is bound here and is not a parameter a plugin could
    get wrong — or borrow.
    """

    def __init__(self, registry: ContributionRegistry, plugin_name: str) -> None:
        self._registry = registry
        self._plugin_name = plugin_name

    @property
    def plugin_name(self) -> str:
        """The plugin these contributions are attributed to."""
        return self._plugin_name

    def contribute(
        self,
        point: ContributionPoint[T],
        value: T,
        *,
        contribution_id: Optional[str] = None,
        order: int = 0,
    ) -> Dispose:
        """Contribute to a point, as this plugin."""
        return self._registry.add(
            self._plugin_name,
            point,
            value,
            contribution_id=contribution_id,
            order=order,
        )

    def extend(
        self,
        point: ContributionPoint[T],
        target_id: str,
        value: Any,
        *,
        contribution_id: Optional[str] = None,
        order: int = 0,
    ) -> Dispose:
        """Add to one contribution of a point, as this plugin.

        The point a host reads back with
        :meth:`ContributionRegistry.extensions_of`. What the value means is
        the host's business: a wrapper, an overlay of fields, a validator.
        """
        return self._registry.add(
            self._plugin_name,
            extension_point(point, target_id),
            value,
            contribution_id=contribution_id,
            order=order,
        )
