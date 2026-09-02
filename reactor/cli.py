# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

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
from typing import Optional

import typer

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


def extend(cli: typer.Typer, platform: PluginPlatform | None = None) -> list[str]:
    """Give every installed extension the chance to add its commands.

    Returns the names of the plugins that added something, so a host can say so.
    A plugin that fails to register is skipped rather than fatal — see
    :meth:`~reactor.reactor.PluginPlatform.register_cli`. One broken extension
    must not take the whole command line down.
    """
    platform = platform or load_platform()
    return platform.register_cli(cli)


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
