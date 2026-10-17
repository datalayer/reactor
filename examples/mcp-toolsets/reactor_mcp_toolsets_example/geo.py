# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""The ``geo`` toolset: capitals and countries, opt-in.

The other half of the example: a toolset nobody gets unless they ask for it
(``/mcp?geo``), from an extension that is not even woken until then — its
manifest waits on ``onToolset:geo``. A client that never asks never reads
these tool descriptions, and the extension never runs.

@module reactor_mcp_toolsets_example.geo
"""

from __future__ import annotations

from collections.abc import Sequence

from mcp.types import ToolAnnotations
from reactor import PluginManifest
from reactor_mcp_server import McpExtension, Toolset, on_toolset, tool

#: What a client names in its URL.
TOOLSET = "geo"

#: A handful of countries, enough to call the tools with. A real extension
#: would read a dataset; the toolset would be declared the same way.
CAPITALS = {
    "argentina": "Buenos Aires",
    "australia": "Canberra",
    "belgium": "Brussels",
    "brazil": "Brasília",
    "canada": "Ottawa",
    "china": "Beijing",
    "egypt": "Cairo",
    "france": "Paris",
    "germany": "Berlin",
    "india": "New Delhi",
    "italy": "Rome",
    "japan": "Tokyo",
    "kenya": "Nairobi",
    "mexico": "Mexico City",
    "nigeria": "Abuja",
    "spain": "Madrid",
    "united kingdom": "London",
    "united states": "Washington, D.C.",
}

LOOKUP = ToolAnnotations(
    read_only_hint=True,
    destructive_hint=False,
    idempotent_hint=True,
    open_world_hint=False,
)


class GeoExtension(McpExtension):
    """Look capitals up, both ways."""

    def manifest(self) -> PluginManifest:
        return PluginManifest(
            name="geo",
            version="0.1.0",
            description="Capitals and countries, as an example of an opt-in toolset.",
            # Registered, but not woken until a URL names the toolset.
            activation_events=[on_toolset(TOOLSET)],
        )

    def toolsets(self) -> Sequence[Toolset]:
        return (
            Toolset(
                name=TOOLSET,
                title="Geography",
                description="Look up the capital of a country, or the country of a capital.",
                default=False,
            ),
        )

    @tool(title="Get Capital of Country", annotations=LOOKUP)
    async def get_capital_of_country(self, country: str) -> str:
        """Return the capital city of a country, by the country's English name."""
        capital = CAPITALS.get(country.strip().lower())
        if capital is None:
            raise ValueError(f"No capital known for '{country}'.")
        return capital

    @tool(title="Get Country of Capital", annotations=LOOKUP)
    async def get_country_of_capital(self, capital: str) -> str:
        """Return the country a capital city belongs to, by the city's English name."""
        wanted = capital.strip().lower()
        for country, city in CAPITALS.items():
            if city.lower() == wanted:
                return country.title()
        raise ValueError(f"No country known with the capital '{capital}'.")


def extension() -> GeoExtension:
    """The entry point ``reactor.mcp.extensions`` loads."""
    return GeoExtension()
