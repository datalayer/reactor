---
sidebar_position: 1
title: Plugins Manager
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
[how a plugin presents itself](/typescript-plugins/plugins).

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

## The contribution points as a table: `contributionsTablePlugin`

The manager lists plugins; a contributions table lists **points** — for each
contribution point, what the plugins put in it. It is the view a plugin's author
reaches for (_did my plugin contribute to every point it meant to?_) and the one
a host shows to explain what an extension adds. It is drawn with Primer's
`DataTable` and, like the rest of the manager, knows no point by name: it reads
the platform's `describeContributions()`.

```tsx
import { buildReactorFromPlugins } from '@datalayer/reactor';
import { ReactorSlot, useReactor } from '@datalayer/reactor/react';
import { CONTRIBUTIONS_TABLE_SLOT, contributionsTablePlugin } from '@datalayer/reactor-manager';

const reactor = buildReactorFromPlugins([
  CorePlugin,
  AcmePlugin,
  contributionsTablePlugin({
    points: MY_POINTS, // every one gets a row, empty or not
    plugin: '@acme/everything', // only this plugin's contributions
    labels: { 'acme.command': 'commands', 'acme.function': 'functions' },
    title: 'Contribution points',
    subtitle: 'Each point, and what @acme/everything contributes to it.',
  }),
]);

// …in the host:
<ReactorSlot slot={CONTRIBUTIONS_TABLE_SLOT} />;
```

| Option     | What it does                                                                                                                                                                                                                  |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `points`   | The points to show, in this order, by id or as the points themselves. Each gets a row, so a point nothing contributed to says _none_ instead of vanishing. Absent, every point that holds something, in the platform's order. |
| `plugin`   | Only this plugin's contributions; the column is then titled _Contributed by_ that plugin. Absent, every plugin's, each contribution followed by its plugin.                                                                   |
| `labels`   | A name for some points, shown beside the id.                                                                                                                                                                                  |
| `title`    | The table's title; _Contributions_ by default, with the row count beside it.                                                                                                                                                  |
| `subtitle` | A line under the title.                                                                                                                                                                                                       |
| `slot`     | The component slot it is contributed to; `contributions-table` (`CONTRIBUTIONS_TABLE_SLOT`) by default.                                                                                                                       |

It follows the platform's revision, so the table changes as plugins are enabled
and disabled. `ContributionsTable` is the component for a host that places it
itself, and `contributionsTableRows` the pure function that computes its rows,
for a test.

Both tables ship in 1.3.4. The [Cells](https://cells.datalayer.tech) examples
use them: the command palette page lists the Cells commands with
`commandsTablePlugin`, and the plugin page lists every Cells point with what an
example plugin contributes, with `contributionsTablePlugin`.
