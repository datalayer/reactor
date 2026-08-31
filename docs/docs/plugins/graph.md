---
sidebar_position: 2
title: Plugin graph
---

# `@datalayer/reactor-graph`

The graph draws a platform: extensions, plugins, their dependencies, the
contribution points that exist, and who contributes to each one — across both
tiers.

```ts
import { GraphPlugin } from '@datalayer/reactor-graph';

const reactor = buildReactorFromPlugins([GraphPlugin, /* … */]);
```

```tsx
<ReactorSlot slot="graph" props={{ backendUrl, backendPlugins }} />
```

## Why the two props

The frontend half of the graph is *derived*: the reactor already knows its own
plugins, dependencies and contributions.

The backend half is **fetched**, because it lives in another process —
`GET /plugins` says who exists and what they depend on, and `GET /contributions`
says what has been contributed to which point.

`backendPlugins` is optional. Left out, the graph fetches the list itself; handed
in, it uses what the caller gave it — which is what keeps the graph and a
[plugins manager's](/plugins/manager) switches in agreement rather than showing
two answers that disagree by one request.

## What the edges mean

| Edge | Reads as |
| --- | --- |
| `depends on` | this plugin will not activate before that one |
| `groups` | this extension delivered that plugin |
| `contributes to` | this plugin filled that contribution point |
| `declares` | this plugin opened that contribution point |

`groups` is what makes *"what would I uninstall to lose this view?"* answerable
by following arrows — see [Extensions](/typescript/extensions).

:::tip
The graph is in the [live demo](/examples/music/demo) — press **View plugin
graph** in the sidebar. Note where that button comes from: the application never
draws it. It says only that it has a second view and how to reach it, and this
plugin contributes the control. Untick **Graph** in the plugin list and the
button goes with it, which is the whole argument for a plugin owning its own
entry point.
:::
