---
sidebar_position: 2
title: REPL
---

# The REPL example

`examples/repl` — an interactive session whose commands come from plugins.

The sibling of the [CLI example](/examples/cli): same platform, same plugin
shape, different surface. The host ships `/help` and `/exit` and answers a
plain line by echoing it uppercased — standing in for whatever a real host
answers with. The plugin contributes `/time`, with an alias (`/clock`), an
`Alt+T` shortcut, and an argument whose choices complete in the slash menu.

```bash
pip install "datalayer_reactor[repl]"
python examples/repl/host.py
```

```
An extensible REPL. / for the menu, /exit to leave.
❯ /he<tab>          # the slash menu completes
❯ /time utc         # the plugin's command, its argument completed too
❯ hello there       # plain input goes to respond()
you said: HELLO THERE
❯ /exit
```

| File | What it shows |
|---|---|
| `host.py` | Building a `ReactorRepl`: the registry, the built-ins, `respond`, entry-point discovery |
| `clock_plugin.py` | A plugin: one `provide_slash_commands` hook, a spec with alias, shortcut, group and completable argument |

The mechanism is documented on [The REPL](/python-plugins/repl). The real-world
consumer is the agent-runtimes terminal chat, which runs its Pydantic AI
sessions on exactly this machinery — its slash menu, shortcuts and command
registry are the ones this example demonstrates.
