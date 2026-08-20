# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""An example CLI extension: a `weather` command group for a Typer host.

A CLI extension is an ordinary reactor plugin implementing one hook,
``provide_cli``. The host hands over its Typer application, the plugin adds
the commands it ships, and from then on they are the host's own — help text,
completion, exit codes, everything.

The plugin travels as any reactor plugin does: registered directly (as
`host.py` here does — no plugin distribution to install, though the
``reactor`` package itself must be importable, which the host arranges), or
advertised by its distribution under an entry-point group and picked up by
``PluginPlatform.discover``::

    [project.entry-points."reactor.demo.cli"]
    weather = "weather_plugin:plugin"
"""

from __future__ import annotations

import typer

from reactor import PluginManifest

#: What the plugin is, for the platform: compatibility, tags, identity.
manifest = PluginManifest(
    name="weather",
    version="1.0.0",
    description="Weather commands for the demo host CLI.",
    author="Datalayer",
    tags=["cli", "example"],
)


#: The commands the plugin ships, as a Typer of their own. Building them as a
#: sub-application keeps the plugin testable alone: `weather_app` runs without
#: any host at all.
weather_app = typer.Typer(name="weather", help="Weather, as this example fakes it.")


@weather_app.command()
def today(city: str = typer.Argument("Brussels", help="City to report on.")) -> None:
    """The weather of the day."""
    typer.echo(f"{city}: 21°C, clear — says the weather extension.")


@weather_app.command()
def forecast(
    city: str = typer.Argument("Brussels", help="City to report on."),
    days: int = typer.Option(3, "--days", "-d", help="How many days ahead."),
) -> None:
    """The days ahead."""
    for day in range(1, days + 1):
        typer.echo(f"{city} +{day}d: {19 + day}°C")


class WeatherCliPlugin:
    """The plugin: one hook, registering the commands into the host."""

    def provide_cli(self, cli: typer.Typer) -> None:
        cli.add_typer(weather_app)


def plugin() -> tuple[PluginManifest, WeatherCliPlugin]:
    """What an entry point resolves to: the manifest and the implementation."""
    return manifest, WeatherCliPlugin()
