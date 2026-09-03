# Extensible REPL Example

An interactive session whose slash commands come from reactor plugins.

The host (`host.py`) ships `/help` and `/exit`, and answers a plain line by
echoing it uppercased — standing in for whatever a real host answers with (the
agent-runtimes terminal chat answers with a Pydantic AI agent, on exactly this
machinery). Everything else arrives through the reactor: a plugin implements
the `provide_slash_commands` hook, receives the host's
`SlashCommandRegistry`, and registers what it ships. The example plugin
(`clock_plugin.py`) contributes `/time`, with an alias, an `Alt+T` shortcut,
and an argument whose choices complete in the slash menu.

Run it from this folder. The `reactor` package must be importable — the host
falls back to the checkout two folders up, so a plain clone works.
`prompt_toolkit` is the one hard prerequisite
(`pip install "datalayer_reactor[repl]"`).

```bash
python host.py
❯ /he<tab>          # the slash menu completes
❯ /time utc         # the plugin's command, its argument completed too
❯ hello there       # plain input goes to respond()
❯ /exit
```

## The contract

A REPL extension is three small things:

1. A `PluginManifest` — its identity for the platform.
2. An implementation with a `provide_slash_commands(registry)` method — given
   the host's registry, it registers `SlashCommandSpec`s
   (`registry.try_register(...)`, so a collision costs a warning, not the
   session).
3. A `plugin()` factory returning `(manifest, implementation)` — what an
   entry point resolves to.

What the REPL core (`reactor.repl.ReactorRepl`) provides for free: the
prompt loop, the slash menu with per-command argument completion, keyboard
shortcuts from each command's `shortcut`, dispatch by name or alias, the
follow-up-prompt convention (a handler may return text for the host's
`respond`, as if the person had typed it), and `ReplExit` to leave.
