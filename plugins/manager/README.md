[![Datalayer](https://assets.datalayer.tech/datalayer-25.svg)](https://datalayer.io)

# 🔌 `@datalayer/reactor-manager`

Lists every plugin in a `@datalayer/reactor` platform and switches each one on
and off while the application runs.

## Why it is a plugin

A sidebar that manages plugins is the one surface whose whole job is the plugin
system itself. Every host that offered one had written its own, which meant
every host answered the same questions slightly differently — and each of them
hard-coded whatever else belonged beside the list.

This one depends on no other plugin and knows none of them by name. It reads
the platform through the Reactor API that every plugin already has, which is
why it can list plugins written long after it.

## What it draws

- A filter across name, identifier and description.
- A row per plugin: emoji, display name, description.
- A switch per row, calling `reactor.enable` / `reactor.disable`. `switchSize`
  (`'small'` by default, or `'medium'`) sets how large it is.
- Whatever other plugins contribute to `manager-actions`, above the list.

## Using it

```tsx
import { buildReactorFromPlugins, configurePlugin } from '@datalayer/reactor';
import { ReactorSlot, useReactor } from '@datalayer/reactor/react';
import { PluginsManagerPlugin } from '@datalayer/reactor-manager';

const reactor = buildReactorFromPlugins([
  configurePlugin(PluginsManagerPlugin, {
    // Anything the application would break without. The manager protects
    // itself by default; naming your own replaces that, so include it unless
    // you mean to allow switching the sidebar off.
    protected: ['@datalayer/reactor-manager', '@your/shell'],
  }),
  /* your own */
]);

export function App() {
  useReactor(reactor);
  // Whatever you pass reaches the plugins contributing to `manager-actions`.
  return <ReactorSlot slot="sidebar" props={{ showingGraph, onToggleGraph }} />;
}
```

## Hiding an implementation detail

A thin adapter and the generic plugin it depends on are one feature to the
person reading the sidebar, and two switches for one feature is a question they
cannot answer. `hidden` (config) or `hiddenPlugins` (prop) leaves one out:

```tsx
configurePlugin(PluginsManagerPlugin, {
  hidden: ['@datalayer/reactor-graph'], // the adapter is the switch that matters
});
```

A host's decision rather than something inferred from the dependency graph. A
dependency is often worth switching on its own — the music example asks you to
try exactly that — so hiding every one of them would remove the point.

## Plugins the manager cannot find

The reactor in this browser is not always the whole system. An application with
plugins on the other side of a wire has a second set to manage, and a person
should not have to learn two controls because of where a plugin happens to run.

A plugin contributes a **source**: a heading and a component that renders its
own rows with `PluginList` — the same one the manager uses — and keeps whatever
fetching its tier needs to itself.

```tsx
contribution(ManagerPluginSource, {
  title: 'Backend plugins (Python)',
  order: 100,                      // after the browser's own, which are 0
  Component: BackendPluginSource,
});

function BackendPluginSource({ query, switchSize }: PluginSourceProps) {
  const { plugins, toggle } = useBackendPlugins();
  return (
    <PluginList
      plugins={plugins.map(toManagedPlugin)}
      query={query}
      switchSize={switchSize}
      onToggle={(name, next) => void toggle(name, next)}
    />
  );
}
```

A component rather than a list, because the manager would otherwise be calling
somebody else's hook — which it cannot do conditionally, and the set of sources
changes as plugins are switched.

## The actions slot

A plugin that wants a control in the sidebar contributes to
`MANAGER_ACTIONS_SLOT` rather than asking the host to draw one:

```tsx
build: () => ({
  components: [
    { slot: MANAGER_ACTIONS_SLOT, id: 'my-toggle', Component: MyToggle },
  ],
}),
```

It receives the props the host gave the manager, unchanged. The manager has no
idea what your control needs in order to navigate, and no business inventing
one — but the control appears and disappears with the plugin that owns it,
which is the point.

## Mounting the view directly

A host that would rather place the list itself can render `PluginsManagerView`
and pass `protectedPlugins`, skipping the plugin and its config.
