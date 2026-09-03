# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""An example REPL extension: a ``/time`` command for the demo host.

A REPL extension is an ordinary reactor plugin implementing one hook,
``provide_slash_commands``. The host hands over its registry, the plugin
registers what it ships, and from then on the commands are the host's own —
the slash menu, the completion, the shortcut, everything.

The argument below is the part worth copying: its ``choices`` drive the slash
menu's second stage, so typing ``/time `` offers the zones — and because
``choices`` may be a callable, a real plugin completes against live state
rather than a list frozen at import.

The plugin travels as any reactor plugin does: registered directly (as
``host.py`` here does), or advertised by its distribution under an
entry-point group and picked up by ``PluginPlatform.discover``::

    [project.entry-points."reactor.demo.repl"]
    clock = "clock_plugin:plugin"
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from reactor import (
    CommandArgSpec,
    PluginManifest,
    SlashCommandRegistry,
    SlashCommandSpec,
)

#: What the plugin is, for the platform: compatibility, tags, identity.
manifest = PluginManifest(
    name="clock",
    version="1.0.0",
    description="A /time command for the demo REPL.",
    author="Datalayer",
    tags=["repl", "example"],
)

ZONES = ("local", "utc")


async def time_command(argv: str) -> Optional[str]:
    """Tell the time, in the zone asked for."""
    zone = (argv or "local").strip().lower()
    if zone == "utc":
        now = datetime.now(timezone.utc)
    else:
        now = datetime.now()
    print(f"{zone}: {now:%H:%M:%S}")
    return None


class ClockReplPlugin:
    """The plugin: one hook, registering the command into the host."""

    def provide_slash_commands(self, registry: SlashCommandRegistry) -> None:
        registry.try_register(
            SlashCommandSpec(
                name="time",
                aliases=("clock",),
                description="What time it is",
                group="Clock",
                shortcut="escape t",
                args=(
                    CommandArgSpec(
                        name="zone",
                        description="local or utc",
                        choices=lambda: ZONES,
                    ),
                ),
                handler=time_command,
                source="clock",
            )
        )


def plugin() -> tuple[PluginManifest, ClockReplPlugin]:
    """What an entry point resolves to: the manifest and the implementation."""
    return manifest, ClockReplPlugin()
