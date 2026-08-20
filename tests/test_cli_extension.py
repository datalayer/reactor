# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""The CLI face of the reactor: plugins add commands to a host application."""

from __future__ import annotations

from reactor import PluginManifest, PluginPlatform


class _FakeCli:
    """Stands in for a typer.Typer: the reactor never looks inside."""

    def __init__(self):
        self.groups: list[str] = []

    def add_typer(self, group) -> None:
        self.groups.append(group)


class _WeatherPlugin:
    def provide_cli(self, cli) -> None:
        cli.add_typer("weather")


class _RenamedParameterPlugin:
    """Names its parameter `app`: the hook is called positionally."""

    def provide_cli(self, app) -> None:
        app.add_typer("renamed")


class _BrokenPlugin:
    def provide_cli(self, cli) -> None:
        raise RuntimeError("this extension is broken")


class _MutePlugin:
    """No provide_cli at all: a plugin need not touch the CLI."""


def _manifest(name: str) -> PluginManifest:
    return PluginManifest(name=name, version="1.0.0")


def test_register_cli_gives_every_plugin_the_host_application():
    platform = PluginPlatform()
    platform.register_plugin(_manifest("weather"), _WeatherPlugin())
    platform.register_plugin(_manifest("mute"), _MutePlugin())
    cli = _FakeCli()

    registered = platform.register_cli(cli)

    assert cli.groups == ["weather"]
    assert registered == ["weather"]


def test_the_plugin_names_its_own_parameter():
    platform = PluginPlatform()
    platform.register_plugin(_manifest("renamed"), _RenamedParameterPlugin())
    cli = _FakeCli()

    assert platform.register_cli(cli) == ["renamed"]
    assert cli.groups == ["renamed"]


def test_a_broken_extension_does_not_take_the_cli_down():
    platform = PluginPlatform()
    platform.register_plugin(_manifest("broken"), _BrokenPlugin())
    platform.register_plugin(_manifest("weather"), _WeatherPlugin())
    cli = _FakeCli()

    registered = platform.register_cli(cli)

    assert cli.groups == ["weather"]
    assert registered == ["weather"]


def test_a_disabled_plugin_registers_nothing():
    platform = PluginPlatform()
    platform.register_plugin(_manifest("weather"), _WeatherPlugin())
    platform.disable_plugin("weather")
    cli = _FakeCli()

    assert platform.register_cli(cli) == []
    assert cli.groups == []


def test_discover_skips_unknown_groups_quietly():
    platform = PluginPlatform()
    assert platform.discover("reactor.tests.no-such-group") == []
