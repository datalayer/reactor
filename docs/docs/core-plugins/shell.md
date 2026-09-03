---
sidebar_position: 4
title: Shell
---

# `@datalayer/reactor-shell`

The shell plugin other plugins extend. A shell — a workspace, a store, a
CMS — usually has one control whose options come from everybody else: which
editor, which panel, which mode. This plugin is that control made generic.

```tsx
import { buildReactorFromPlugins, contribution } from '@datalayer/reactor';
import { ShellPlugin, ShellView } from '@datalayer/reactor-shell';

const NotebookPlugin = definePlugin({
  name: '@me/notebook',
  contributes: [
    contribution(ShellView, {
      id: 'notebook',
      title: 'Notebook',
      order: 10,
    }),
  ],
});

const reactor = buildReactorFromPlugins([ShellPlugin, NotebookPlugin]);
```

It owns four things:

- **A view point** — its own `ShellView` by default, or one the host already
  declared, passed through `config.point`. Contributions are what populate
  everything else.
- **A segmented selector** that renders into a slot (`config.slot`) and shows
  **nothing at all** until a plugin contributes: an empty application is an
  empty control, not a fake one. A view that cannot open right now stays
  focusable and says why (`aria-disabled` plus a title), rather than
  disappearing.
- **A choice store** (`chooseView`, `getViewChoice`, `subscribeViewChoice`,
  `nextView`) that commands can read and cycle from outside React.
- **A cycle command** in the reactor's registry, `Mod+Alt+E` by default —
  reachable from the [command palette](/core-plugins/commands) like everything
  else.

What a chosen view *does* is the host's business: every choice goes through
the configurable `announce` callback, whose return value says whether anyone
was listening — a command invoked with nobody on the other end says so
rather than appearing to work.

## Configuration

| Option | Default | What it does |
|---|---|---|
| `point` | `ShellView` | The contribution point the views arrive through |
| `describe` | identity | Maps a contributed value (+ the slot's props as context) to `{ id, title, icon?, order?, disabled?, disabledReason? }` |
| `slot` | `'header'` | Where the selector renders |
| `defaultView` | `'none'` | Seeded into the store, not announced |
| `showSelector` | `true` | The control; the store and command remain either way |
| `announce` | `() => true` | Told of every choice; returns whether anyone heard |
| `commandId`, `keybinding` | `shell.cycleView`, `Mod+Alt+E` | The cycle command |
| `noneLabel`, `ariaLabel` | `None`, `View` | Words |

## Grown from Loop

This plugin is the LOOP workspace's editor selector, generalised. The loop's
own shell plugin in `@datalayer/agent-runtimes` is now a thin wrapper: it
points `config.point` at the loop's editor contribution point, `describe`
gates each editor against the live workspace, and `announce` forwards the
choice to the chat's surface-request channel. The
[Loop documentation](https://datalayer.ai) describes that composition.
