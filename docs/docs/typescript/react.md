---
sidebar_position: 8
title: React bindings
---

# React bindings

Everything on this page is exported from `@datalayer/reactor/react`. The core
runtime does not import React, so a platform can run without it.

| Export | What it does |
| --- | --- |
| `useReactor` | registers the reactor in the zustand store and manages its lifecycle |
| `ReactorSlot` | renders plugin-provided components by named slot |
| `useSlotComponents` | what is currently in a slot — for a layout that must adapt when it empties |
| `useReactorPlatform` | reactor access for runtime toggles |
| `useContributions` | subscribes to a contribution point |
| `ReactorViewHost` | renders the one contribution the application chose |
| `ReactorLazy` | a lazily-loaded component with Suspense and an error boundary |
| `usePluginManifests` | the plugin list |
| `useExtensionManifests` | the extensions |
| `useGroupedPluginManifests` | the plugin list arranged by the extension that delivered it |
| `useBackendPlugin` | whether an optional backend plugin is present |
| `useReactorEvent` | fires an event when a value changes — activating and deactivating whatever was waiting on it |

## Mounting a platform

```tsx
const reactor = buildReactorFromPlugins([HeaderPlugin, StoreExtension]);

export default function App() {
  useReactor(reactor, { isBackendPluginAvailable });
  return <ReactorSlot slot="header" />;
}
```

`isBackendPluginAvailable` is the predicate that decides whether a component
gated on [`requiredBackendPlugins`](/cross-tier/declaring-dependencies) renders.
Pass it as a hook result, not a bare function, so that the reactor is told when
the answer changes.

## Slots

```tsx
<ReactorSlot slot="cart-actions" />
```

`ReactorSlot` renders a fragment. A slot filled by two plugins puts two children
wherever it sits — which in a CSS grid means two grid items, in two columns. Wrap
a slot in a `<div>` of your own when its contents must stay together:

```tsx
<Box sx={{ display: 'grid', gap: 4 }}>
  <ReactorSlot slot="main" />
</Box>
```

## Asking whether a slot is empty

A layout with a column per slot has to have an answer for the column being
switched off:

```tsx
const hasShop = useSlotComponents('main').length > 0;
```

With the shop off there is no first column, and what is left takes the whole
width rather than sitting beside a hole. The
[music example](/examples/music/architecture) does exactly this.

## Subscribing to a contribution point

```tsx
const rules = useContributions(PlaylistRulePoint);
```

This re-renders on its own when a contributing plugin is enabled or disabled, so
a chooser built from it is never stale. Reading the point is also an
[activation event](/typescript/activation-events): plugins waiting on it are
fetched by this call.
