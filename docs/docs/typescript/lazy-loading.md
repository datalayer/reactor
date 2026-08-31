---
sidebar_position: 7
title: Lazy loading
---

# Lazy loading

Laziness happens at two levels, and they are worth keeping apart because they
defer different things.

- **A lazy plugin** defers its *module* — the code, and everything that code
  imports.
- **A lazy contribution** defers one *component* while the plugin that offers it
  is already up.

Most applications want both: the plugin arrives early enough to appear in a
menu, and the heavy view behind the menu entry arrives when somebody picks it.

## Lazy plugins

`defineLazyPlugin` declares a plugin whose module is fetched *after* the
platform has started.

```ts
const HeavyPlugin = defineLazyPlugin({
  name: '@app/heavy',
  displayName: 'Heavy',
  octicon: 'package',
  dependencies: [BasePlugin],
  load: () => import('./heavy'),
});

const reactor = buildReactorFromPlugins([HeavyPlugin]);
reactor.start();           // returns as soon as the eager plugins registered
await reactor.whenReady(); // only if you need the rest — tests usually do
```

`start()` activates everything already loaded and returns. Modules are then
fetched **in parallel** and activated **in dependency order**: one slow module
must not hold up the others' downloads, but a dependant must never activate
before what it depends on. Each activation is its own change, so a UI fills in
plugin by plugin rather than in one late jump.

What a host needs before the code arrives is declared on the reference rather
than inside the module — the name, the dependencies, the backend plugins, the
presentation. That is the manifest/entry-point split made concrete, and it is
what lets a plugin list be complete from the first frame instead of growing as
modules land:

```ts
reactor.getManifest('@app/heavy'); // → { displayName: 'Heavy', lazy: true, loaded: false, … }
```

## Lazy plus an activation event is the useful combination

On its own, a lazy plugin is fetched right after `start()` — off the critical
path, but still fetched on every page load. Add an
[activation event](/typescript/activation-events) and it is not fetched at all
until something asks:

```ts
defineLazyPlugin({
  name: '@app/notebook-toolbar',
  displayName: 'Notebook toolbar',
  activationEvents: [onContributionPoint(NotebookToolbar)],
  load: () => import('./plugin'),
});
```

A session where nobody opens a notebook never downloads it, and it is listed,
described, drawn on the graph and switchable the whole time.

| you want | declare |
| --- | --- |
| up before the first paint | a plain plugin |
| off the critical path, but always loaded | `defineLazyPlugin`, no activation events |
| not loaded unless it is wanted | `defineLazyPlugin` + `activationEvents` |

## Lazy contributions

A contribution can carry a module thunk instead of a component, so the plugin's
own entry stays light while its view is deferred:

```ts
contribution(ViewType, {
  title: 'Notebook',
  load: () => import('./NotebookView'),   // fetched when the view is chosen
});
```

`ReactorViewHost` and `ReactorLazy` render these with Suspense and an error
boundary, so a slow module shows a fallback and a failed one shows an error
rather than a blank panel:

```tsx
<ReactorViewHost point={ViewType} active={activeViewType} fallback={<Spinner />} />
```

## Keep the entry point light

The rule that makes all of this pay: anything a plugin's `index` imports lands
in the shell's bundle, however lazy the plugin's views are. A plugin whose
manifest file imports a charting library has already spent the money. Put the
manifest in `index.ts`, the code in a module it `load`s.

## Properties worth knowing

| Situation | What happens |
| --- | --- |
| a module fails to load | that plugin is missing; `whenReady()` still resolves and everything else carries on |
| `disable()` before the module lands | it loads but does not activate; `enable()` activates it once it is there |
| `start()` twice over one load | one fetch, one activation — React StrictMode's start/stop/start is exactly this |
| the module says less than the reference | the reference fills in the gaps; what the module says always wins |
| a plugin is deactivated and reactivated | one fetch — the module is kept, only the phases run again |

## On the Python tier

There is no module on the wire, so the deferral is *construction*: register a
`factory` instead of an implementation, and the object is not built until an
activation event fires. See
[Python extensions and events](/python/extensions-and-events).
