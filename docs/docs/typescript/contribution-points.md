---
sidebar_position: 3
title: Contribution points
---

# Contribution points

A contribution point answers *"what do plugins offer, so the application can
choose?"*. See [slots or contribution points](/overview/slots-vs-contribution-points)
for when this is the wrong tool.

## Defining one, contributing to it

```ts
import { defineContributionPoint, contribution, definePlugin } from '@datalayer/reactor';

type ViewType = {
  title: string;
  load: () => Promise<{ default: React.ComponentType }>;
};

export const ViewTypePoint = defineContributionPoint<ViewType>('app.viewType');

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

The id is the contract between plugins; the type parameter is what makes
contributing to it type-safe.

## Rendering the one the application chose

```tsx
import { ReactorViewHost } from '@datalayer/reactor/react';

<ReactorViewHost
  point={ViewTypePoint}
  active={activeViewType}
  props={{ workspace }}
  fallback={<Spinner />}
  empty={<EmptyState />}
/>;
```

Contributions are ordered by `order` and then by contribution order, and they
are disposed with the plugin that made them: disabling a plugin removes its
views from the switcher without the application tracking anything.

## Declaring a point you own

A point with no contributors yet is still worth drawing on a graph or listing in
a manager, and the registry only ever knows contributors. Declare it:

```ts
definePlugin({
  name: '@app/playlist',
  contributionPoints: [PlaylistRulePoint],
});
```

## Enablement rules stay in the application

The reactor stores records and hands them back; whether a view *may* be opened
right now — a notebook that needs a running kernel — is a question about your
domain, not about the platform.

## Reading a point is an event

This is the property that inverts the dependency, and it has its own page:
[activation events](/typescript/activation-events).

## Gates

`defineGate` declares a point whose contributions are booleans-with-a-reason
rather than records: a plugin may veto something the application is about to do,
and the application asks the gate rather than asking each plugin.
