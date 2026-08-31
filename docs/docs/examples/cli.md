---
sidebar_position: 4
title: CLI
---

# The CLI example

`examples/cli` — a host with no browser in it.

The Python tier's `provide_cli` hook lets a plugin contribute commands to a
command-line application, and `provide_slash_commands` does the same for an
interactive session — a terminal, a prompt, a command palette. This example is a
host and a weather plugin, and nothing else.

```bash
pip install -e .
python examples/cli/host.py
```

| File | What it shows |
| --- | --- |
| `host.py` | a `PluginPlatform` in a program that is not a server |
| `weather_plugin.py` | `provide_cli`, and a manifest that describes itself |

It is worth reading precisely because it has no frontend: the constructs on the
[Python runtime](/python/) pages are not a mirror of the browser's, they are the
model — and this is the model with the browser removed.
