---
sidebar_position: 1
title: Plugins manager
---

# `@datalayer/reactor-manager`

The plugins manager lists every plugin on the platform and switches each one on
and off while the application runs. It is a plugin, so it appears in its own
list — and it never offers to switch *itself* off, because a manager that could
would have no way back.

```ts
import { PluginsManagerPlugin } from '@datalayer/reactor-manager';

const reactor = buildReactorFromPlugins([PluginsManagerPlugin, /* … */]);
```

It contributes to the `sidebar` slot, so the application decides where the list
lives without knowing what is in it.

## What it draws, and from where

Everything comes from the manifest, which is why a plugin that has never been
fetched still has a row: `displayName`, `description`, `emoji`/`octicon`,
`version`, and whether it is enabled. See
[how a plugin presents itself](/typescript/plugins).

## Extending it: `ManagerPluginSource`

The manager opens a contribution point for *sources* of plugins. A plugin that
knows about plugins the reactor cannot see contributes a source, and its rows
appear inside the one list, in the one shape:

```ts
contributes: [
  contribution(
    ManagerPluginSource,
    {
      title: 'Backend plugins (Python)',
      order: 100,
      Component: BackendPluginSource,
    },
    { id: 'music-backend-plugins' },
  ),
],
```

That is exactly what the [music example](/examples/music/switching-plugins) does
for its four Python plugins: the manager cannot know that
`POST /plugins/{name}/toggle` exists on some server, and it does not have to.

`PluginList` is exported for a source to render its rows with, so a contributed
group looks like the manager's own rather than like a second control that
happens to sit nearby.
