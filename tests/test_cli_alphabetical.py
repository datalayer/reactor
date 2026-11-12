# Copyright (c) 2026-Present Datalayer, Inc.
#
# BSD 3-Clause License

"""A reactor command line lists its commands alphabetically, at every level."""

from __future__ import annotations

import click
import typer
from typer.core import TyperGroup
from typer.main import get_command
from typer.testing import CliRunner

from reactor import PluginManifest, PluginPlatform
from reactor.cli import AlphabeticalGroup, alphabetical, extend
from reactor.cli import app as reactor_app

runner = CliRunner()


def _noop() -> None:
    """Does nothing."""


def _application() -> typer.Typer:
    """A host registered out of order: zebra, apple, and a `tools` group."""
    cli = typer.Typer(name="host", no_args_is_help=True)
    cli.command("zebra")(_noop)
    cli.command("apple")(_noop)
    tools = typer.Typer(name="tools", no_args_is_help=True)
    tools.command("wrench")(_noop)
    tools.command("anvil")(_noop)
    cli.add_typer(tools)
    return cli


def _names(cli: typer.Typer, *path: str) -> list[str]:
    """What the group at `path` lists — what help and completion both read."""
    group = get_command(cli)
    ctx = click.Context(group)
    for name in path:
        group = group.get_command(ctx, name)
        ctx = click.Context(group, parent=ctx)
    return group.list_commands(ctx)


class _MangoPlugin:
    """An extension: one command and one group, registered after the host's."""

    def provide_cli(self, cli: typer.Typer) -> None:
        cli.command("mango")(_noop)
        fruit = typer.Typer(name="banana", no_args_is_help=True)
        fruit.command("split")(_noop)
        fruit.command("peel")(_noop)
        cli.add_typer(fruit)


def _platform() -> PluginPlatform:
    platform = PluginPlatform()
    platform.register_plugin(PluginManifest(name="mango", version="1.0.0"), _MangoPlugin())
    return platform


def test_typer_alone_lists_in_registration_order():
    # The premise: without the reactor, the order is the order of registration.
    assert _names(_application()) == ["zebra", "apple", "tools"]


def test_the_root_and_a_nested_group_list_alphabetically():
    cli = alphabetical(_application())

    assert _names(cli) == ["apple", "tools", "zebra"]
    assert _names(cli, "tools") == ["anvil", "wrench"]


def test_extend_orders_what_the_extensions_brought():
    cli = _application()

    assert extend(cli, _platform()) == ["mango"]

    assert _names(cli) == ["apple", "banana", "mango", "tools", "zebra"]
    assert _names(cli, "banana") == ["peel", "split"]
    assert _names(cli, "tools") == ["anvil", "wrench"]


def test_a_command_registered_late_still_lists_in_order():
    cli = _application()
    extend(cli, _platform())

    # After the reactor is done with the application: a command at the root,
    # one in a group that was there, and a whole new group.
    cli.command("cherry")(_noop)
    tools = next(g.typer_instance for g in cli.registered_groups if g.typer_instance.info.name == "tools")
    tools.command("hammer")(_noop)

    assert _names(cli) == ["apple", "banana", "cherry", "mango", "tools", "zebra"]
    assert _names(cli, "tools") == ["anvil", "hammer", "wrench"]


def test_help_lists_alphabetically_within_each_panel():
    cli = typer.Typer(name="host", no_args_is_help=True)
    cli.command("zebra")(_noop)
    cli.command("yak", rich_help_panel="Animals")(_noop)
    cli.command("apple")(_noop)
    cli.command("bear", rich_help_panel="Animals")(_noop)
    alphabetical(cli)

    result = runner.invoke(cli, ["--help"], env={"NO_COLOR": "1", "TERM": "dumb"})

    assert result.exit_code == 0
    out = result.output
    assert out.index("apple") < out.index("zebra")
    assert out.index("bear") < out.index("yak")
    # The panels themselves are not merged: both default-panel commands come
    # before both of the named panel's.
    assert out.index("zebra") < out.index("bear")


def test_options_keep_their_order():
    cli = typer.Typer(name="host")

    @cli.command("run")
    def run(zulu: bool = False, alpha: bool = False) -> None:
        """Runs."""

    cli.command("other")(_noop)
    alphabetical(cli)

    out = runner.invoke(cli, ["run", "--help"], env={"NO_COLOR": "1", "TERM": "dumb"}).output
    assert out.index("--zulu") < out.index("--alpha")


def test_completion_offers_the_commands_alphabetically():
    cli = alphabetical(_application())
    group = get_command(cli)

    from click.shell_completion import ShellComplete

    offered = [item.value for item in ShellComplete(group, {}, "host", "_HOST_COMPLETE").get_completions([], "")]

    assert offered == ["apple", "tools", "zebra"]


def test_a_group_class_of_the_applications_own_is_kept():
    class Loud(TyperGroup):
        def get_help(self, ctx: click.Context) -> str:
            return "LOUD"

    cli = typer.Typer(name="host", cls=Loud)
    cli.command("zebra")(_noop)
    cli.command("apple")(_noop)
    alphabetical(cli)
    # Twice is once.
    alphabetical(cli)

    group = get_command(cli)
    assert isinstance(group, Loud) and isinstance(group, AlphabeticalGroup)
    assert group.list_commands(click.Context(group)) == ["apple", "zebra"]
    assert group.get_help(click.Context(group)) == "LOUD"
    assert cli.info.cls.__mro__.count(AlphabeticalGroup) == 1


def test_what_is_not_a_typer_application_is_left_alone():
    host = object()

    assert alphabetical(host) is host


def test_the_reactor_command_lists_its_own_alphabetically():
    names = _names(reactor_app)

    assert names == sorted(names)
    assert _names(reactor_app, "plugins") == ["activate", "deactivate", "disable", "enable", "list"]
