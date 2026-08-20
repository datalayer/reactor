# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""An extensible Typer CLI, built on the reactor.

The host owns its Typer application and its built-in commands — here a single
`hello`. Everything else arrives as reactor plugins: each one implements
``provide_cli`` and adds its commands to the application before it runs.

Run it from this folder::

    python host.py --help          # hello, plus the weather group
    python host.py hello
    python host.py weather today Paris
    python host.py weather forecast Paris --days 5

Two ways plugins reach the host, both shown below:

- ``register_plugin``: the host registers an implementation it holds — what
  this example does, so it runs from a plain checkout.
- ``discover``: installed distributions advertise plugins under an
  entry-point group, and the host picks up whatever is installed. This is how
  the Datalayer CLI finds its extensions (group ``datalayer.cli``) — install
  a distribution carrying the entry point, and its commands are there.
"""

from __future__ import annotations

import typer

from reactor import PluginPlatform

app = typer.Typer(
    name="demo",
    help="A host CLI whose commands come from reactor plugins.",
    no_args_is_help=True,
)


@app.command()
def hello(name: str = typer.Argument("world")) -> None:
    """The one command the host itself ships."""
    typer.echo(f"Hello {name}, from the host.")


def extend(cli: typer.Typer) -> None:
    """Give every plugin the chance to add its commands."""
    platform = PluginPlatform()

    # Installed distributions first: whatever advertises itself under the
    # group is registered, nothing is named here.
    platform.discover("reactor.demo.cli")

    # And the local example plugin, registered directly so the demo runs
    # from a checkout with nothing installed.
    from weather_plugin import plugin

    manifest, implementation = plugin()
    if manifest.name not in {p["name"] for p in platform.list_plugins()}:
        platform.register_plugin(manifest, implementation)

    platform.register_cli(cli)


def main() -> None:
    extend(app)
    app()


if __name__ == "__main__":
    main()
