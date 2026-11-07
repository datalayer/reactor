---
sidebar_position: 2
title: Plugin Graph
---

# `@datalayer/reactor-graph`

The graph draws a platform: where remote plugins are served from, extensions,
plugins, their dependencies, the contribution points that exist, and who
contributes to each one — across both tiers.

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
[plugins manager's](/core-plugins/manager) switches in agreement rather than showing
two answers that disagree by one request.

## The columns

Read left to right, a row says where a module came from, which package
delivered it, what it is, where it meets others, and what it needs on the
server:

| Column | Holds |
| --- | --- |
| Remotes | where a [remote plugin's](/typescript-plugins/federation#where-a-plugin-came-from) module is served from: one node per container, or per module URL |
| Extensions | the packages that delivered plugins |
| Frontend (TypeScript) | the browser's plugins |
| Contribution points | where plugins meet without importing each other |
| Backend (Python) | the server's plugins |

A platform with no remote plugins draws the first column empty, which is itself
the answer: everything came with the shell. A plugin whose module never
arrived says why in its tooltip — the manifest's `loadError`.

## What the edges mean

| Edge | Reads as |
| --- | --- |
| `serves` | this remote serves that plugin's module |
| `depends on` | this plugin will not activate before that one |
| `groups` | this extension delivered that plugin |
| `contributes to` | this plugin filled that contribution point |
| `declares` | this plugin opened that contribution point |

`groups` is what makes *"what would I uninstall to lose this view?"* answerable
by following arrows — see [Extensions](/typescript-plugins/extensions).

:::tip
The graph is in the [live demo](/examples/music/demo) — press **View plugin
graph** in the sidebar. Note where that button comes from: the application never
draws it. It says only that it has a second view and how to reach it, and this
plugin contributes the control. Untick **Graph** in the plugin list and the
button goes with it, which is the whole argument for a plugin owning its own
entry point.
:::
