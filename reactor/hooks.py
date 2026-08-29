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
    def provide_contributions(self, contributions: Any) -> None:
        """Contribute to the host's contribution points.

        The host passes a :class:`~reactor.contributions.PluginContributions`
        bound to this plugin, and the plugin calls
        ``contributions.contribute(point, value)`` for whatever it offers — a
        view the workspace may open, a panel, a command.

        Unlike the other hooks, this one is not "react to an event". It is
        "declare what you have", so the host can enumerate the options and
        choose. Contributions live as long as the plugin is registered and go
        with it when it is unregistered.
        """

    @hookspec
    def provide_slash_commands(self, registry: Any) -> None:
        """Register the plugin's interactive commands into the host's registry.

        The sibling of :meth:`provide_cli`, for hosts that are not a command
        line but a session: an interactive terminal, a chat prompt, a command
        palette. The host passes its own registry — the reactor stays
        framework-agnostic and hands the object over; the plugin knows what it
        is and calls ``registry.register(...)``.

        Keeping this separate from ``provide_cli`` is deliberate. A command
        group added to a CLI and a command typed at a live prompt have
        different lifetimes: one is resolved once at startup, the other runs
        against a session that already exists.
        """

    @hookspec
    def provide_cli(self, cli: Any) -> None:
        """Register the plugin's commands into the host CLI application.

        The host passes its command-line application — a ``typer.Typer`` for
        the Datalayer CLI — and the plugin adds what it ships:
        ``cli.add_typer(...)``, ``cli.command(...)``. The reactor stays
        framework-agnostic: it hands the object over, the plugin knows what
        it is.
        """
