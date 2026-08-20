# Extensible CLI Example

A [Typer](https://typer.tiangolo.com) CLI whose commands come from reactor
plugins.

The host (`host.py`) ships one command of its own, `hello`. The rest arrives
through the reactor: a plugin implements the `provide_cli` hook, receives the
host's Typer application, and adds what it ships. The example plugin
(`weather_plugin.py`) contributes a `weather` command group.

Run it from this folder. The `reactor` package must be importable — the host
falls back to the checkout two folders up, so a plain clone works; an
installed reactor (`pip install -e ../..` from here, or `pip install
datalayer_reactor`) works the same. `typer` is the one hard prerequisite.

```bash
python host.py --help                       # hello + weather
python host.py hello
python host.py weather today Paris
python host.py weather forecast Paris -d 5
```

## The contract

A CLI extension is three small things:

1. A `PluginManifest` — its identity for the platform.
2. An implementation with a `provide_cli(cli)` method — given the host's
   Typer application, it registers its commands (`cli.add_typer(...)`).
3. A `plugin()` factory returning `(manifest, implementation)` — what an
   entry point resolves to.

## Distribution

Registered directly (as this example does, so it runs from a checkout), or
advertised by the extension's own distribution under an entry-point group:

```toml
[project.entry-points."reactor.demo.cli"]
weather = "weather_plugin:plugin"
```

The host then discovers whatever is installed:

```python
platform = PluginPlatform()
platform.discover("reactor.demo.cli")
platform.register_cli(app)
```

This is exactly how the Datalayer CLI finds its extensions — the group is
`datalayer.cli`, and `agent-runtimes` registers its command groups
(`sandboxes`, `agents`, `envs`, …) into `datalayer` this way. Installing a
distribution that carries the entry point is all it takes for its commands to
appear.
