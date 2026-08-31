---
sidebar_position: 1
title: Plugins
---

# Plugins

## How a plugin presents itself

`name` is an identifier: `@app/notebook` is what other plugins depend on and
what a dependency graph is drawn from. It is not what a person should be shown.

Four optional fields say that instead — and the same four exist on the Python
[`PluginManifest`](/python/plugins), so a host listing both tiers never has to
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
[deactivation](/typescript/deactivation) walks when it stands dependants down.

For the other wire — what this plugin needs from the Python tier — see
[Across the tiers](/cross-tier/declaring-dependencies).

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

The rule that pays for everything on the [lazy loading](/typescript/lazy-loading)
page: anything a plugin's `index` imports lands in the shell's bundle, however
lazy the plugin's views are. A plugin whose manifest file imports a charting
library has already spent the money.

> Put the manifest in `index.ts`, and the code in a module it `load`s.
