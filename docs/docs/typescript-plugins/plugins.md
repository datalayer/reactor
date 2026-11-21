---
sidebar_position: 1
title: Plugins
---

# Plugins

## How a plugin presents itself

`name` is an identifier: `@app/notebook` is what other plugins depend on and
what a dependency graph is drawn from. It is not what a person should be shown.

Four optional fields say that instead — and the same four exist on the Python
[`PluginManifest`](/python-plugins/plugins), so a host listing both tiers never has to
ask which side a plugin came from.

```ts
definePlugin({
  name: '@app/notebook',
  displayName: 'Notebook',
  description: 'Runs notebooks, and owns the kernel they run on.',
  octicon: 'book',      // an id, not a component
  emoji: '📓',
});
```

The icon is named rather than imported on purpose. A component could only come
from the tier that imported it; an id is a string a Python manifest can carry
too, and the host decides what it draws — which is the only place that decision
belongs.

Read it back with `getManifest`, or in React with `usePluginManifests()`:

```ts
reactor.getManifest('@app/notebook');
// { name, displayName: 'Notebook', description, octicon, emoji, version,
//   requiredBackendPlugins: [], optionalBackendPlugins: [], lazy, loaded }
```

Nothing here is required. A plugin that says none of it still runs, and
`displayName` falls back to `name`, so a host always has something to print.

## How a plugin describes itself

A catalogue shows more of a plugin than its name and face: the package to
install, how it is configured, what it fills and adds. Those are on the
manifest too, all optional, readable before the module is fetched:

```ts
definePlugin({
  name: '@app/notebook',
  package: '@app/notebook-ui',              // what ships it, on npm
  tags: ['notebook', 'jupyter'],
  config: { lineNumbers: true },
  configSchema: {                           // its settings, as a JSON Schema
    type: 'object',
    properties: {
      lineNumbers: { type: 'boolean', title: 'Line numbers', default: true },
    },
  },
  declares: {                               // what it does in its phases
    slots: ['app.main'],
    contributesTo: ['app.toolbar'],
    commands: ['notebook.run'],
  },
  metadata: { myHost: { placements: ['main'] } }, // the host's own, carried as is
});
```

`getManifest` returns them with `tags`, `slots` and `commands` as lists
(empty when nothing is said). `contributesTo` is the points of the plugin's
`contributes` records together with those it `declares`, and `commands` the
ids of its `commands` records with those it `declares`: a contribution or a
command made in a phase is only known once the plugin has run, so saying it
in `declares` is what lets a host list it first. The reactor never checks a
declaration; a host that wants one held to what the plugin does compares it
with the registry after `start()`. `metadata` is read by nobody but the host
that wrote it.

`package`, `tags`, `configSchema` and `metadata` are the Python manifest's
`package`, `tags`, `config_schema` and `metadata`.

## Declaring what a plugin needs

```ts
definePlugin({
  name: '@app/notebook',
  dependencies: [BasePlugin],       // must be present, and activated first
  peerDependencies: [ThemePlugin],  // used if present
  conflictsWith: ['@app/legacy-notebook'],
});
```

Dependencies decide activation order and are what
[deactivation](/typescript-plugins/deactivation) walks when it stands dependants down.

For the other wire — what this plugin needs from the Python tier — see
[Cross-tier Dependencies](/cross-tier-dependencies/).

## What a plugin contributes

Two ways, and they are not interchangeable:

```ts
export const NotebookPlugin = definePlugin({
  name: '@app/notebook',
  // Declarative: resolved during the register phase.
  contributes: [
    contribution(
      ViewTypePoint,
      { title: 'Notebook', load: () => import('./NotebookView') },
      { id: 'notebook', order: 10 },
    ),
  ],
  // Imperative: for contributions that depend on build output, or that appear
  // later. Returns a disposer.
  register(ctx) {
    if (ctx.reactor.hasPlugin('@app/sandbox')) {
      ctx.contribute(ViewTypePoint, { title: 'Sandbox', load: () => import('./SandboxView') }, { id: 'sandbox' });
    }
  },
});
```

Declare with `contributes` when nothing about the contribution depends on what
the plugin built. Reach for `ctx.contribute` when it does — or when the
contribution is not knowable until something else has registered.

## Slot components

A plugin's `build()` may return components for named slots. Everything
contributed to a slot is rendered; see
[slots or contribution points](/overview/slots-vs-contribution-points).

```ts
definePlugin({
  name: '@app/header',
  build() {
    return {
      components: [
        { slot: 'header', id: 'app-header', Component: AppHeader },
      ],
    };
  },
});
```

## Keep the entry point light

The rule that pays for everything on the [lazy loading](/typescript-plugins/lazy-loading)
page: anything a plugin's `index` imports lands in the shell's bundle, however
lazy the plugin's views are. A plugin whose manifest file imports a charting
library has already spent the money.

> Put the manifest in `index.ts`, and the code in a module it `load`s.
