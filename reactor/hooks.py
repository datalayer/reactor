# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

from typing import Any

import pluggy

hookspec = pluggy.HookspecMarker("reactor")
hookimpl = pluggy.HookimplMarker("reactor")


class ReactorHookSpecs:
    @hookspec
    def on_reactor_start(self, tenant_id: str | None = None) -> None:
        """Called when the reactor starts globally or for a tenant."""

    @hookspec
    def on_reactor_stop(self, tenant_id: str | None = None) -> None:
        """Called when the reactor stops globally or for a tenant."""

    @hookspec
    def provide_routes(self) -> list[dict]:
        """Return route descriptors consumed by API or gateway layers."""

    @hookspec
    def feature_flags(self, tenant_id: str) -> dict[str, bool]:
        """Return plugin-provided feature flags for a tenant."""

    @hookspec
    def provide_cli(self, cli: Any) -> None:
        """Register the plugin's commands into the host CLI application.

        The host passes its command-line application — a ``typer.Typer`` for
        the Datalayer CLI — and the plugin adds what it ships:
        ``cli.add_typer(...)``, ``cli.command(...)``. The reactor stays
        framework-agnostic: it hands the object over, the plugin knows what
        it is.
        """
