---
sidebar_position: 7
title: Extensible CLI
---

# Extending the command line

`reactor` is a [Typer](https://typer.tiangolo.com) application built the way the
reactor asks applications to build theirs: a host with a few commands of its
own, plus whatever the extensions installed beside it contribute. Nothing in the
host names an extension.

```bash
pip install datalayer_reactor
reactor --help
```

```
Commands
  serve       Serve a platform that runs whatever is installed beside it.
  commands    The commands plugins have registered — the palette, from a terminal.
  extensions  What is installed beside this reactor.
  plugins     Inspect and switch the plugins of a running reactor.
```

Install an extension and its commands are simply there:

```bash
pip install music-catalog-plugin
reactor --help          # ... plus `catalog`
reactor catalog songs
```

Nothing was configured, and nothing on the host side mentions the package.
Uninstall it and the group goes.

## Running against a server

`plugins` talks to a reactor that is already serving, because switching a plugin
off only means something in a process that is running one:

```bash
reactor plugins list                       # --url, default http://127.0.0.1:8787
reactor plugins disable cms.gallery
reactor plugins enable  cms.gallery
reactor plugins deactivate cms.gallery
reactor plugins activate   cms.gallery
```

```
🖼️ cms.gallery        on  active  Gallery
🔎 cms.seo-validator  on  idle    SEO Validator
```

Two independent facts, and a person needs both. **on/off** is a decision that
sticks; **active/idle** is whether it is running right now. A plugin can be
switched on and still be standing down, waiting for one of its activation
events — and `activate` is how to say the reason has arrived without waiting for
one.

`deactivate` stands dependants down first and the plugin comes back on its next
activation event; `disable` is the switch a person threw.

## Why Typer

Extensions are expected to *share code with the host*. A Typer sub-application
is an ordinary object a plugin can build, test on its own, and hand over — and
the host's help, completion and exit codes then cover it like its own commands.

An argparse host can be extended too, but only by handing plugins a mutable
parser and hoping they agree about subparsers.

## Writing a CLI extension

One hook, `provide_cli`. The host passes its application; the plugin adds what
it ships:

```python
class CatalogPlugin:
    def provide_cli(self, cli) -> None:
        import typer

        catalog_app = typer.Typer(name="catalog", help="The song catalog.")

        @catalog_app.command("songs")
        def songs(artist: str = typer.Option(None, help="Only songs by this artist.")) -> None:
            """List the songs in the catalog."""
            ...

        cli.add_typer(catalog_app)
```

Building the commands as a Typer of their own is what keeps them testable alone:
`catalog_app` runs without any host at all.

The reactor stays framework-agnostic — it hands the object over, and the plugin
knows what it is. A plugin that fails to register is skipped with a warning,
never fatal: one broken extension must not take the whole command line down.

## Being discovered

Declare an entry point in the distribution that ships the plugin. The entry
point resolves to a callable returning `(PluginManifest, implementation)`:

```toml
[project.entry-points."datalayer.reactor.cli"]
catalog = "catalog_plugin:plugin"
```

```python
def plugin() -> tuple[PluginManifest, CatalogPlugin]:
    return CATALOG_MANIFEST, CatalogPlugin()
```

Two groups are scanned, and which one to use is a question about the rest of the
package:

| Group | For |
| --- | --- |
| `datalayer.reactor.extensions` | anything already shipping a UI or a backend — [extensions](/python-packaged-extensions) declare this group anyway, so no second declaration is needed to also ship commands |
| `datalayer.reactor.cli` | a distribution that *only* extends the command line and has no reason to be loaded by a server |

## Commands on the command line

`provide_cli` and [`provide_slash_commands`](/commands-registry) answer
different questions, and both reach the CLI.

`provide_cli` is *"what commands does this plugin add to the command line?"* —
resolved once, at startup, before anything runs.

`provide_slash_commands` is *"what can somebody invoke in a session?"* Those are
the registry's commands, and `reactor commands` surfaces them:

```bash
reactor commands list
reactor commands run catalog.describe
```

```
🎵 catalog.describe  Describe the catalog
🔎 cms.seo.rules     Show the SEO rules
✨ cms.pro.rewrite   Rewrite the selection
```

So the same command is reachable from a terminal and from Ctrl-K in the browser
without being written twice. Keeping the two hooks separate is deliberate: a
command group added to a CLI and a command invoked in a live session have
different lifetimes — one is resolved once at startup, the other runs against a
session that already exists.

## Serving

`reactor` with no subcommand still serves, because it was a server before it was
a command line and the shortest way to start one should not have got longer:

```bash
reactor                       # the same as `reactor serve`
reactor serve --port 9000
```

## Hosting your own

`reactor.cli` is one application built from parts you can use for your own:

```python
from reactor.cli import extend

app = typer.Typer(name="mytool")

@app.command()
def hello() -> None:
    ...

extend(app)     # every installed extension adds its commands
app()
```

`examples/cli` is the smallest version of this — a host, a weather plugin, and
no browser anywhere. See [the CLI example](/examples/cli).

The Datalayer CLI is the biggest: `datalayer` hosts its extensions through
this exact machinery (`extend` over the `datalayer.cli` group), and the
platform's own packages extend back — install `datalayer_core` or
`agent-runtimes` beside the `reactor` command and their command groups
(`auth`, `secrets`, `sandboxes`, `agents`, …) are simply there, advertised
under `datalayer.reactor.cli`.

## Interactive sessions

The same story for a prompt instead of a command line — an extensible REPL
with a slash menu plugins fill — is [The REPL](/python-plugins/repl).
