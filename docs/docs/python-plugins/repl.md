---
sidebar_position: 8
title: Extensible REPL
---

# Extending an interactive session

The [CLI page](/python-plugins/cli) shows the reactor's answer for command lines: a
host with a few commands of its own, plus whatever installed extensions
contribute. `reactor.repl` is the same answer for *interactive* sessions — a
prompt loop whose vocabulary is a registry plugins fill.

```python
from reactor import SlashCommandRegistry, SlashCommandSpec
from reactor.repl import ReactorRepl, ReplExit

registry = SlashCommandRegistry()

async def bye(argv: str):
    raise ReplExit()

registry.register(SlashCommandSpec(name="exit", handler=bye))

async def respond(text: str):
    ...  # an agent, an interpreter, a search box — the host's business

repl = ReactorRepl(registry, respond=respond)
repl.discover("my.app.plugins")   # entry-point discovery, see below
await repl.run()
```

What the REPL supplies, so every interactive host stops rewriting it:

- **The prompt loop** — `prompt_toolkit`, async, with sane EOF (reads as
  `/exit`) and Ctrl-C (clears the line, does not leave).
- **The slash menu** — type `/` and every registered command completes with
  its description beside it; type past the name and the *command's own
  arguments* complete, their choices resolved at the moment of asking, so a
  command completes against live state rather than a list frozen at import.
- **Keyboard shortcuts** — a command's `shortcut` (`"escape x"` is Alt+X, in
  `prompt_toolkit` spelling) becomes a binding that types and submits it.
- **Dispatch** — `/name args` resolves by name or alias, the handler receives
  the argument text, and a returned string becomes a *follow-up prompt*
  handed to `respond` exactly as if the person had typed it — how a
  `/suggestions` command turns a pick into a message. Unknown commands are
  reported, never swallowed.

What it deliberately does not know is what a prompt is *for*. Anything typed
without a slash goes to `respond`. The agent-runtimes terminal chat
(`agent-runtimes chat`) builds its Pydantic-AI session on exactly this
machinery; nothing in `reactor.repl` imports pydantic-ai.

`prompt_toolkit` is the one soft dependency:

```bash
pip install "datalayer_reactor[repl]"
```

## The extensibility mechanism

Two layers, and a plugin only ever touches the first:

**The registry.** `SlashCommandSpec` carries everything a surface needs:
name, aliases, description, a `/help` group, a `shortcut`, and `args` whose
`choices` may be callables. `register` refuses collisions loudly (the error
names the plugin that owns the name); `try_register` is the posture for
anything *discovered* — a clash costs a warning, never the session.

**Discovery.** A distribution advertises a plugin under an entry-point group;
the plugin implements one hook:

```python
class MyReplPlugin:
    def provide_slash_commands(self, registry):
        registry.try_register(SlashCommandSpec(
            name="deploy",
            description="Ship it",
            group="Operations",
            handler=deploy,
            source="my-package",
        ))
```

```toml
[project.entry-points."my.app.plugins"]
my-package = "my_package.repl_plugin:plugin"
```

`repl.discover("my.app.plugins")` loads every advertised plugin and hands it
the registry; the return value names the ones that contributed, so a session
can say what it found. The agent-runtimes terminal discovers under its own
group, `loop.plugins` — one distribution can serve both by advertising under
both groups.

`provide_slash_commands` is the interactive sibling of the
[`provide_cli`](/python-plugins/cli) hook, and the same mirror exists in the browser:
the LOOP workspace's `LoopCommand` contributions are the TypeScript spelling
of the same spec, so a command is described identically in a terminal and in
a web palette even when the two implementations differ.

## Try it

The [REPL example](/examples/repl) is the whole story in two files: a host
with `/help` and `/exit`, and a plugin contributing `/time` with a shortcut
and completable arguments.
