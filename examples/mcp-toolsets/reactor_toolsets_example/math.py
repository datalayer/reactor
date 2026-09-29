# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""The ``math`` toolset: arithmetic, on by default.

The smallest useful extension: a manifest, one toolset, and tools written as
methods. It declares nothing about activation, so it is registered when the
host starts and served to every client that does not leave it out
(``/mcp?without=math``).

@module reactor_toolsets_example.math
"""

from __future__ import annotations

from collections.abc import Sequence

from mcp.types import ToolAnnotations
from reactor import PluginManifest
from reactor_mcp_server import McpExtension, Toolset, tool

#: What a client names in its URL.
TOOLSET = "math"

#: Pure functions of their arguments: nothing is read or written, the same
#: call answers the same, and nothing outside the process is reached.
PURE = ToolAnnotations(
    read_only_hint=True,
    destructive_hint=False,
    idempotent_hint=True,
    open_world_hint=False,
)


class MathExtension(McpExtension):
    """Add and multiply."""

    def manifest(self) -> PluginManifest:
        return PluginManifest(
            name="math",
            version="0.1.0",
            description="Arithmetic, as an example of a toolset on by default.",
        )

    def toolsets(self) -> Sequence[Toolset]:
        return (
            Toolset(
                name=TOOLSET,
                title="Math",
                description="Add and multiply numbers.",
                # Only reaches a client whose session has this toolset.
                instructions=(
                    "Use the math tools for arithmetic instead of computing in "
                    "your head, and give the tool's answer as is."
                ),
            ),
        )

    @tool(title="Add", annotations=PURE)
    async def add(self, a: float, b: float) -> float:
        """Add two numbers and return the sum."""
        return a + b

    @tool(title="Multiply", annotations=PURE)
    async def multiply(self, a: float, b: float) -> float:
        """Multiply two numbers and return the product."""
        return a * b


def extension() -> MathExtension:
    """The entry point ``reactor.mcp.extensions`` loads."""
    return MathExtension()
