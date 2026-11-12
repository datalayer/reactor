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


ENV = {"NO_COLOR": "1", "TERM": "dumb", "COLUMNS": "120"}


def _in_order(text: str, *words: str) -> bool:
    """Whether the words appear in the text in the order given."""
    positions = [text.index(word) for word in words]
    return positions == sorted(positions)


def _optioned() -> typer.Typer:
    """A host whose options are declared out of order, at three levels."""
    cli = typer.Typer(name="host", no_args_is_help=True)

    @cli.callback()
    def root(
        version: bool = typer.Option(False, "--version"),
        api_key: str = typer.Option("", "--api-key"),
        ai_agents_url: str = typer.Option("", "--ai-agents-url"),
    ) -> None:
        """The host."""

    @cli.command("run")
    def run(
        second: str = typer.Argument("b"),
        first: str = typer.Argument("a"),
        zulu: bool = typer.Option(False, "--zulu", "-a"),
        mike: bool = typer.Option(False, "--mike/--no-mike"),
        alpha: bool = typer.Option(False, "--alpha", "-z"),
    ) -> None:
        """Runs."""
        typer.echo(f"{second} {first}")

    tools = typer.Typer(name="tools", no_args_is_help=True)

    @tools.callback()
    def tools_root(yes: bool = False, dry_run: bool = False) -> None:
        """The tools."""

    @tools.command("wrench")
    def wrench(size: int = 1, grip: str = "") -> None:
        """Turns."""

    cli.add_typer(tools)
    return cli


def test_options_list_alphabetically_at_every_level_with_help_last():
    cli = alphabetical(_optioned())

    root = runner.invoke(cli, ["--help"], env=ENV).output
    # By the long name: `--ai-agents-url` before `--api-key`. `--version` and
    # the completion options sit where the alphabet puts them; `--help` closes.
    assert _in_order(
        root,
        "--ai-agents-url",
        "--api-key",
        "--install-completion",
        "--show-completion",
        "--version",
        "--help",
    )
    command = runner.invoke(cli, ["run", "--help"], env=ENV).output
    # The long name decides, not the short one beside it.
    assert _in_order(command, "--alpha", "--mike", "--zulu", "--help")
    group = runner.invoke(cli, ["tools", "--help"], env=ENV).output
    assert _in_order(group, "--dry-run", "--yes", "--help")
    nested = runner.invoke(cli, ["tools", "wrench", "--help"], env=ENV).output
    assert _in_order(nested, "--grip", "--size", "--help")


def test_positional_arguments_are_not_reordered():
    cli = alphabetical(_optioned())

    usage = runner.invoke(cli, ["run", "--help"], env=ENV).output
    assert _in_order(usage, "[SECOND]", "[FIRST]")
    # And the call means what it meant.
    assert runner.invoke(cli, ["run", "one", "two"]).output.strip() == "one two"


def test_the_options_of_a_command_registered_late_list_in_order():
    cli = _application()
    extend(cli, _platform())

    @cli.command("cherry")
    def cherry(stone: bool = False, pit: bool = False) -> None:
        """Late."""

    assert _in_order(runner.invoke(cli, ["cherry", "--help"], env=ENV).output, "--pit", "--stone", "--help")


def test_options_are_processed_in_the_order_they_were_declared():
    # Click asks the prompts, and runs the callbacks, in declared order: only
    # the listing is alphabetical.
    cli = typer.Typer(name="host")

    @cli.command("ask")
    def ask(
        zulu: str = typer.Option(..., prompt="zulu"),
        alpha: str = typer.Option(..., prompt="alpha"),
    ) -> None:
        typer.echo(f"zulu={zulu} alpha={alpha}")

    cli.command("other")(_noop)
    alphabetical(cli)

    result = runner.invoke(cli, ["ask"], input="first\nsecond\n")
    assert "zulu=first alpha=second" in result.output
    assert _in_order(runner.invoke(cli, ["ask", "--help"], env=ENV).output, "--alpha", "--zulu")


def test_completion_offers_the_options_alphabetically():
    from click.shell_completion import ShellComplete

    group = get_command(alphabetical(_optioned()))
    offered = [
        item.value
        for item in ShellComplete(group, {}, "host", "_HOST_COMPLETE").get_completions(["run"], "--")
    ]

    assert offered == ["--alpha", "--mike", "--no-mike", "--zulu", "--help"]


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
