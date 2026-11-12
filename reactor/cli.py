# Copyright (c) 2026-Present Datalayer, Inc.
#
# BSD 3-Clause License

"""The `reactor` command: a Typer application that installed extensions extend.

The reactor's own command line is built the way it asks applications to build
theirs — as a host with a few commands of its own, plus whatever the extensions
installed beside it contribute. Nothing here names an extension.

Typer rather than argparse because extensions are expected to *share code with
the host*: a Typer sub-application is an ordinary object a plugin can build,
test on its own, and hand over, and the host's help, completion and exit codes
then cover it like anything else. An argparse host can be extended too, but only
by handing plugins a mutable parser and hoping they agree about subparsers.

Two hooks reach this file, and they answer different questions:

``provide_cli``
    "What commands does this plugin add to the command line?" Resolved once, at
    startup, before anything runs.

``provide_slash_commands``
    "What can somebody invoke in a session?" Those are the commands in the
    registry — the palette's commands — and they are surfaced here by
    ``reactor commands``, so the same command is reachable from a terminal and
    from Ctrl-K without being written twice.

Extensions are discovered under two entry-point groups:

- ``datalayer.reactor.extensions`` — the group everything else already uses, so
  an extension that ships a UI and a backend does not need a second declaration
  to also ship commands.
- ``datalayer.reactor.cli`` — for a distribution that *only* extends the command
  line and has no reason to be loaded by the server.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from typing import Any, Optional

import click
import typer
from typer.core import TyperCommand, TyperGroup
from typer.models import DefaultPlaceholder

from .extensions import EXTENSION_ENTRY_POINT_GROUP
from .reactor import PluginPlatform

logger = logging.getLogger(__name__)

#: For distributions that extend only the command line.
CLI_ENTRY_POINT_GROUP = "datalayer.reactor.cli"

app = typer.Typer(
    name="reactor",
    help=(
        "Serve and inspect a Datalayer Reactor platform. Every extension "
        "installed in this environment is discovered; none is named here."
    ),
    no_args_is_help=False,
    add_completion=True,
)

#: Commands that inspect the registry, grouped so `reactor commands --help`
#: reads as its own thing rather than crowding the top level.
commands_app = typer.Typer(
    name="commands",
    help="The commands plugins have registered — the palette, from a terminal.",
    no_args_is_help=True,
)
app.add_typer(commands_app)

extensions_app = typer.Typer(
    name="extensions",
    help="What is installed beside this reactor.",
    no_args_is_help=True,
)
app.add_typer(extensions_app)

ui_app = typer.Typer(
    name="ui",
    help="The wire between a host and the page that draws it (reactor.ui).",
    no_args_is_help=True,
)
app.add_typer(ui_app)


#: Where a `reactor serve` listens unless told otherwise.
DEFAULT_URL = "http://127.0.0.1:8787"

#: The option every command that talks to a server takes.
URL_OPTION = typer.Option(DEFAULT_URL, "--url", help="The running reactor to talk to.")


def _request(url: str, path: str, *, method: str = "GET", body: dict | None = None) -> Any:
    """One JSON request against a running reactor.

    `urllib` rather than a client library, because the alternative is making
    every install of this package carry an HTTP dependency so that two
    subcommands can work.
    """
    import json
    from urllib.error import HTTPError, URLError
    from urllib.request import Request, urlopen

    payload = json.dumps(body).encode() if body is not None else None
    request = Request(
        url.rstrip("/") + path,
        data=payload,
        method=method,
        headers={"content-type": "application/json"} if payload else {},
    )
    try:
        with urlopen(request, timeout=10) as response:
            return json.loads(response.read() or b"null")
    except HTTPError as error:
        detail = error.read().decode(errors="replace")
        typer.secho(f"{error.code}: {detail}", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from error
    except URLError as error:
        # By far the most common failure, and the one worth naming: there is
        # nothing listening. Saying so beats a stack trace about a socket.
        typer.secho(
            f"No reactor is answering at {url} — is `reactor serve` running?",
            fg=typer.colors.RED,
            err=True,
        )
        raise typer.Exit(code=1) from error


def load_platform(*, discover: bool = True) -> PluginPlatform:
    """A platform with whatever is installed in this environment registered.

    The same discovery the server does, so `reactor commands list` and the
    running server agree about what exists.
    """
    platform = PluginPlatform()
    if discover:
        platform.discover_extensions(EXTENSION_ENTRY_POINT_GROUP)
        platform.discover(CLI_ENTRY_POINT_GROUP)
    return platform


def _option_key(param: click.Parameter) -> tuple[int, str, str]:
    """Where an option lists: by its long name, `--help` after everything."""
    names = [*param.opts, *param.secondary_opts]
    long = next((name for name in names if name.startswith("--")), names[0] if names else "")
    bare = long.lstrip("-")
    return (1 if bare == "help" else 0, bare.lower(), bare)


class _AlphabeticalOptions:
    """Lists a command's options alphabetically — in its help and in completion.

    By the long name (`--ai-agents-url` before `--api-key`), `--help` last;
    `--version` and the completion options sit where the alphabet puts them.
    Positional arguments are not reordered: their order is the call's meaning.

    Only what is *listed* is ordered. Click also reads the declared order to
    decide which option is processed — and which prompt is asked — first, so
    the parameters keep it everywhere but while a help page or a completion
    is being written.
    """

    _listing = 0

    def get_params(self, ctx: click.Context) -> list[click.Parameter]:
        params = super().get_params(ctx)  # type: ignore[misc]
        if not self._listing:
            return params
        arguments = [param for param in params if not isinstance(param, click.Option)]
        options = [param for param in params if isinstance(param, click.Option)]
        return arguments + sorted(options, key=_option_key)

    def format_help(self, ctx: click.Context, formatter: click.HelpFormatter) -> None:
        self._listing += 1
        try:
            super().format_help(ctx, formatter)  # type: ignore[misc]
        finally:
            self._listing -= 1

    def shell_complete(self, ctx: click.Context, incomplete: str) -> list[Any]:
        self._listing += 1
        try:
            return super().shell_complete(ctx, incomplete)  # type: ignore[misc]
        finally:
            self._listing -= 1


class AlphabeticalCommand(_AlphabeticalOptions, TyperCommand):
    """A command that lists its options alphabetically."""


#: The ordered counterpart of each command class met, made once.
_ordered_classes: dict[type, type] = {}


def _alphabetical_command_class(cls: Any) -> type:
    """The command class to use in place of `cls`, listing its options alphabetically."""
    if cls is None or cls is TyperCommand:
        return AlphabeticalCommand
    if issubclass(cls, _AlphabeticalOptions):
        return cls
    ordered = _ordered_classes.get(cls)
    if ordered is None:
        ordered = type(cls.__name__, (_AlphabeticalOptions, cls), {"__module__": cls.__module__})
        _ordered_classes[cls] = ordered
    return ordered


def _alphabetical_command(command: click.Command | None) -> click.Command | None:
    """The command, listing its options alphabetically — whatever its class."""
    if command is not None and not isinstance(command, _AlphabeticalOptions):
        # The command is built already, by Typer, from a class named where it
        # was registered — after this application was ordered, or it would be
        # of an ordered class. It keeps everything of its class and gains the
        # listing.
        command.__class__ = _alphabetical_command_class(type(command))
    return command


class AlphabeticalGroup(_AlphabeticalOptions, TyperGroup):
    """A command group that lists its commands and options in alphabetical order.

    Typer lists commands in the order they were registered, which reads well
    for one author's handful of commands. A reactor command line is assembled
    from whatever is installed: registration order is then the order the
    distributions happened to be discovered in, and nobody can find anything
    in it. The order is decided when the listing is asked for, so a command
    registered late lists in its place; `--help` (within each help panel) and
    shell completion both read it from here.

    The options list alphabetically too — the group's own, and those of every
    command reached through it (see :class:`_AlphabeticalOptions`).
    """

    def list_commands(self, ctx: click.Context) -> list[str]:
        return sorted(super().list_commands(ctx), key=lambda name: (name.lower(), name))

    def get_command(self, ctx: click.Context, cmd_name: str) -> click.Command | None:
        return _alphabetical_command(super().get_command(ctx, cmd_name))


def _alphabetical_class(cls: Any) -> type[TyperGroup]:
    """The group class to use in place of `cls`, listing alphabetically."""
    if isinstance(cls, DefaultPlaceholder):
        cls = cls.value
    if cls is None or cls is TyperGroup:
        return AlphabeticalGroup
    if issubclass(cls, AlphabeticalGroup):
        return cls
    # A group class of the application's own keeps everything it does; only
    # the order of its listing changes.
    return type(cls.__name__, (AlphabeticalGroup, cls), {"__module__": cls.__module__})


def alphabetical(cli: Any) -> Any:
    """Make a Typer application list its commands and options alphabetically, at every level.

    The application and every group under it, however deep — the ones there
    now; :func:`extend` calls this after the extensions have registered. Safe
    to call again. Anything that is not a Typer application (no ``info``) is
    returned untouched, as is a view over one that hands its ``info`` and
    ``registered_groups`` through.
    """
    seen: set[int] = set()

    def visit(application: Any) -> None:
        info = getattr(application, "info", None)
        if info is None or not hasattr(info, "cls") or id(info) in seen:
            return
        seen.add(id(info))
        info.cls = _alphabetical_class(info.cls)
        for command in getattr(application, "registered_commands", None) or []:
            command.cls = _alphabetical_command_class(command.cls)
        for group in getattr(application, "registered_groups", None) or []:
            # `add_typer(..., cls=...)` outranks the application's own class.
            if not isinstance(group.cls, DefaultPlaceholder) and group.cls is not None:
                group.cls = _alphabetical_class(group.cls)
            if group.typer_instance is not None:
                visit(group.typer_instance)

    visit(cli)
    return cli


def extend(cli: typer.Typer, platform: PluginPlatform | None = None) -> list[str]:
    """Give every installed extension the chance to add its commands.

    Returns the names of the plugins that added something, so a host can say so.
    A plugin that fails to register is skipped rather than fatal — see
    :meth:`~reactor.reactor.PluginPlatform.register_cli`. One broken extension
    must not take the whole command line down.
    """
    platform = platform or load_platform()
    registered = platform.register_cli(cli)
    # After the extensions, so the groups they brought are covered too.
    alphabetical(cli)
    return registered


# --------------------------------------------------------------------------
# The host's own commands.
# --------------------------------------------------------------------------


plugins_app = typer.Typer(
    name="plugins",
    help="Inspect and switch the plugins of a running reactor.",
    no_args_is_help=True,
)
app.add_typer(plugins_app)


@plugins_app.command("list")
def plugins_list(url: str = URL_OPTION) -> None:
    """Every plugin the running reactor knows, and whether it is on."""
    plugins = _request(url, "/plugins") or []
    if not plugins:
        typer.echo("This reactor has no plugins.")
        raise typer.Exit()

    state = _request(url, "/plugins/state") or {}
    enabled = {entry["name"]: entry for entry in state.get("plugins", [])}
    width = max(len(entry["name"]) for entry in plugins)
    for entry in plugins:
        name = entry["name"]
        status = enabled.get(name, {})
        # Two independent facts, and a person needs both: a plugin can be
        # switched on and still be standing down, waiting for its event.
        on = status.get("enabled", True)
        up = status.get("activated", True)
        flags = "on " if on else "off"
        flags += " active" if up else " idle"
        mark = entry.get("emoji") or " "
        label = entry.get("display_name") or name
        typer.echo(f"{mark} {name:<{width}}  {flags:<11} {label}")


@plugins_app.command("enable")
def plugins_enable(
    name: str = typer.Argument(..., help="Plugin to switch on."),
    url: str = URL_OPTION,
) -> None:
    """Switch a plugin on. A person's decision, and it sticks."""
    _request(url, f"/plugins/{name}/toggle", method="POST", body={"enabled": True})
    typer.secho(f"{name} enabled.", fg=typer.colors.GREEN)


@plugins_app.command("disable")
def plugins_disable(
    name: str = typer.Argument(..., help="Plugin to switch off."),
    url: str = URL_OPTION,
) -> None:
    """Switch a plugin off, and everything that depends on it."""
    _request(url, f"/plugins/{name}/toggle", method="POST", body={"enabled": False})
    typer.secho(f"{name} disabled.", fg=typer.colors.YELLOW)


@plugins_app.command("activate")
def plugins_activate(
    name: str = typer.Argument(..., help="Plugin to bring up."),
    url: str = URL_OPTION,
) -> None:
    """Bring a plugin up now, dependencies first.

    Not the same as enabling. Enabling is a person's decision and it sticks;
    this says the reason to run has arrived, which is normally an event's job.
    """
    answer = _request(url, f"/plugins/{name}/activate", method="POST") or {}
    if answer.get("activated"):
        typer.secho(f"{name} activated.", fg=typer.colors.GREEN)
    else:
        typer.echo(f"{name} was already active.")


@plugins_app.command("deactivate")
def plugins_deactivate(
    name: str = typer.Argument(..., help="Plugin to stand down."),
    url: str = URL_OPTION,
) -> None:
    """Stand a plugin down, dependants first.

    It keeps its place and comes back when one of its activation events fires;
    to switch it off for good use `disable`.
    """
    answer = _request(url, f"/plugins/{name}/deactivate", method="POST") or {}
    stood_down = answer.get("deactivated") or []
    if not stood_down:
        typer.echo(f"{name} was not active.")
        return
    typer.secho(f"Stood down: {', '.join(stood_down)}", fg=typer.colors.YELLOW)


@app.command()
def serve(
    host: str = typer.Option("127.0.0.1", help="Interface to bind."),
    port: int = typer.Option(8787, help="Port to bind."),
    ui: Optional[str] = typer.Option(
        None, metavar="DIR", help="Serve a built single-page interface from this directory."
    ),
    no_ui: bool = typer.Option(
        False, "--no-ui", help="Serve the API only, without the built interface."
    ),
    reload: bool = typer.Option(False, help="Reload on code changes."),
) -> None:
    """Serve a platform that runs whatever is installed beside it."""
    import uvicorn

    from .host import create_base_app

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    application = create_base_app(with_ui=not no_ui, ui=ui)
    uvicorn.run(application, host=host, port=port, reload=reload)


@extensions_app.command("list")
def extensions_list() -> None:
    """Every extension discovered in this environment."""
    platform = load_platform()
    extensions = platform.list_extensions()
    if not extensions:
        typer.echo("No extensions are installed in this environment.")
        raise typer.Exit()
    for extension in extensions:
        mark = extension.get("emoji") or " "
        label = extension.get("display_name") or extension["name"]
        plugins = ", ".join(extension.get("plugins", []))
        typer.echo(f"{mark} {label}  ({extension['name']})")
        if plugins:
            typer.echo(f"    plugins: {plugins}")


@ui_app.command("schema")
def ui_schema(
    out: Optional[Path] = typer.Option(None, "--out", help="Write it here instead of printing it."),
) -> None:
    """The reactor.ui wire as JSON Schema — what the TypeScript types follow."""
    from .ui.schema import render_schema, write_schema

    if out is None:
        typer.echo(render_schema(), nl=False)
        return
    write_schema(out)
    typer.echo(f"Wrote {out}")


@commands_app.command("list")
def commands_list(
    plugin: Optional[str] = typer.Option(None, help="Only commands from this plugin."),
) -> None:
    """List the commands plugins have registered."""
    platform = load_platform()
    entries = platform.describe_commands()
    if plugin:
        entries = [entry for entry in entries if entry["plugin"] == plugin]
    if not entries:
        typer.echo("No commands are registered by the installed extensions.")
        raise typer.Exit()

    width = max(len(entry["id"]) for entry in entries)
    for entry in entries:
        # The emoji is the command's own; falling back to a space keeps the
        # columns aligned for commands that did not set one.
        mark = entry["emoji"] or " "
        unavailable = "" if entry["enabled"] else "  (unavailable)"
        typer.echo(f"{mark} {entry['id']:<{width}}  {entry['name']}{unavailable}")


@commands_app.command("run")
def commands_run(
    command_id: str = typer.Argument(..., help="Id of the command to run."),
    argument: Optional[str] = typer.Argument(None, help="Optional argument to pass."),
) -> None:
    """Run a registered command by id.

    The same command the palette invokes, from a terminal — which is the point
    of the registry being in the core rather than in whichever surface happened
    to need it first.
    """
    platform = load_platform()
    try:
        result = asyncio.run(platform.execute_command(command_id, argument))
    except KeyError:
        typer.secho(f"No command '{command_id}' is registered.", fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1)
    except RuntimeError as error:
        typer.secho(str(error), fg=typer.colors.YELLOW, err=True)
        raise typer.Exit(code=1)
    if result is not None:
        typer.echo(result)


@app.callback(invoke_without_command=True)
def main_callback(ctx: typer.Context) -> None:
    """Serve when invoked bare, so `reactor` still means "run the server".

    `reactor` was a server before it was a command line, and the shortest way
    to start one should not have become longer because the CLI grew. With a
    subcommand this does nothing and the subcommand runs.
    """
    if ctx.invoked_subcommand is None:
        ctx.invoke(serve)


# The reactor's own commands list alphabetically however the application is
# started — `main` below, or a test's runner on `app`.
alphabetical(app)


def main() -> None:
    """The `reactor` console script."""
    # Extensions are given the application before it parses anything: their
    # commands have to exist by the time `--help` is answered.
    try:
        extend(app)
    except Exception as error:  # noqa: BLE001
        # Discovery reaching into every installed distribution is exactly where
        # a broken environment shows up. Say so and carry on with the built-in
        # commands: a CLI that will not start cannot be used to diagnose itself.
        logger.warning("Extensions could not be loaded: %s", error, exc_info=True)
    app()


if __name__ == "__main__":
    main()
