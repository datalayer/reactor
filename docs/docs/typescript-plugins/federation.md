---
sidebar_position: 10
title: Remote Plugins
---

# Plugins that arrive from a URL

A [lazy plugin](/typescript-plugins/lazy-loading) already defers its module —
`load: () => import('./heavy')`. A **remote** plugin changes one thing: where
that module comes from.

```ts
import { defineRemotePlugin } from '@datalayer/reactor';

const Greeting = defineRemotePlugin({
  name: '@remote/greeting',
  displayName: 'Greeting',
  description: 'Served from somewhere this application was not built with.',
  entry: 'https://example.com/remotes/greeting.js',
});

const reactor = buildReactorFromPlugins([ShellPlugin, Greeting]);
```

`defineRemotePlugin` returns a `LazyPluginRef`. That is the design, and it is
worth stating plainly: **there is no second kind of plugin.** Ordering,
activation events, failure isolation, disable/enable and the graph all work
unchanged, because what the runtime receives is the same thing it always had.

## Two things a URL brings that an import does not

### Shared modules

A module fetched at runtime is not in the host's bundle, so it cannot
`import 'react'` and get the host's copy — it would get a *second* React, whose
hooks throw from inside a component that looks perfectly fine. The host
publishes its copies; a remote borrows them.

```ts
import * as React from 'react';
import * as Reactor from '@datalayer/reactor';

setReactorSharedModules({
  react: React,
  '@datalayer/reactor': Reactor,
});
```

```js
// in the remote
const { react: React } = globalThis.__DATALAYER_REACTOR__.shared;
```

`REACTOR_SHARED_MODULES` is the floor, and `defineRemotePlugin` warns by name
when a host has not published it. It is a floor rather than the whole list: a
host whose plugins draw with a design system must add it, and the runtime
cannot know what that is.

:::note
This is what Module Federation's `shared` does, with the machinery removed —
a remote reads a global, and gets whatever is there. A remote built as a
**container** negotiates instead; see [Containers](#containers) below. Both
kinds go through the same `loader` seam, which is why adding the second was
one function rather than a rewrite.
:::

### A refusal that is not a crash

| Refused for | What the host sees |
| --- | --- |
| an `apiVersion` this runtime does not speak | the plugin stays listed, with the reason |
| an origin that was not allowed | the same |
| a module that threw while evaluating | the same |
| a network that was down | the same |

All four leave `loadError` on the manifest:

```ts
reactor.getManifest('@remote/broken');
// { lazy: true, loaded: false, loadError: 'this remote is broken on purpose', … }
```

That matters more than it sounds. A plugin that is installed but unloadable is
a *state*, and a host that can only show "not here" is asking somebody to guess
between a slow network, a refused origin and a broken module — three different
things to do about it.

Origins are refused by default: a remote runs with the shell's privileges, so
same-origin always passes and anything else must be named.

```ts
defineRemotePlugin(ref, { allowedOrigins: ['https://plugins.example.com'] });
```

## Containers

A plain remote borrows the host's React off a global and hopes it is the right
one. That is enough until two remotes want the same library at compatible but
different versions, or until a remote is a real build with chunks rather than
one file. A **Module Federation container** is the answer to both, and
`defineFederatedPlugin` loads one through the same seam:

```ts
import { defineFederatedPlugin, initReactorFederation } from '@datalayer/reactor';

// Once, after setReactorSharedModules: the same modules, offered the way a
// container negotiates for them — with versions, as singletons.
await initReactorFederation({ name: 'my_shell', versions: { react: React.version } });

const Charts = defineFederatedPlugin({
  name: '@acme/charts',
  displayName: 'Charts',
  entry: 'https://cdn.acme.com/charts/remoteEntry.js',   // the container entry
  scope: 'acme_charts',                                  // the container's name
  module: './plugin',                                    // what it exposes
  activationEvents: [onView('charts')],
}, { allowedOrigins: ['https://cdn.acme.com'] });
```

The manifest half is identical to `defineRemotePlugin`, and that is the point:
listed, described and switchable from the first frame, one lazy plugin in the
platform. What changes is delivery, in three ways.

### Shared dependencies are negotiated

`initReactorFederation` turns what `setReactorSharedModules` published into the
host's offer: each module a singleton, with the version you pass. A container
built with `shared: { react: { requiredVersion: '^19' } }` asks for that range,
and the runtime hands over the host's copy or refuses **by name** — a mismatch
is a load error on the manifest, not a broken hook in a render. `sharedFromHost`
is the function behind it, if a host wants to tighten one module without
restating the rest.

### Entry types

A bundler emits a `global` entry — a script that sets `globalThis[scope]` —
and that is the runtime's default. A container can also be an ES module
exporting `init` and `get`; say so with `type: 'esm'`. The
[federation example](https://github.com/datalayer/reactor/tree/main/examples/federation)
ships one written by hand, forty lines that are the whole protocol, beside the
Rsbuild configuration that emits the real thing.

### Hot updates

A container is registered by name. Pointing the name at new code is the update:

```ts
await updateFederatedRemote('acme_charts', 'https://cdn.acme.com/charts/remoteEntry.js');
```

The entry is cache-busted, re-registered with `force`, and pre-fetched. What is
already on screen keeps running; the next module the container hands out is
the new code. A plugin that must itself be replaced is `uninstall` then
`install`, the same story a local plugin has.

### Type hints

Build the container with `dts: true` and it emits `@mf-types/`; a host can then
type `loadRemote<typeof import('acme_charts/plugin')>()`. Reactor does not need
the hint — a plugin is a plugin — but a host reaching into a container for
anything else does.

### The runtime is optional

`@module-federation/runtime` is an optional peer dependency, imported the first
time a container is actually loaded. A host that never federates never pays
for it. A host whose bundler already initialised the runtime can hand that
instance over with `setFederationRuntime`, so there is one federation host per
page rather than two that share nothing.

## Installing into a platform that is already running

`buildReactorFromPlugins` takes the set an application was built with.
`install` is for the set it did not know about — a URL somebody pasted, an
extension the server reported after a [`pip install`](/python-plugins/packaging),
anything a marketplace hands over.

```ts
await reactor.install(defineRemotePlugin({ name, entry }));
```

Nothing already running is restarted, and the new plugins are **ordered against
the existing ones** rather than appended — so one that depends on something
already installed still activates after it. Installing a name that is already
there is a no-op rather than an error, because asking twice is what a retry
looks like.

## Bootstrapping from a server

When the plugins come from a Reactor backend, `bootstrapExtensions` does the
whole round trip — including the manifests, so the plugin list is complete
before any module is fetched. See
[Packaging an extension](/python-plugins/packaging).

## A worked example

[`examples/federation`](https://github.com/datalayer/reactor/tree/main/examples/federation)
is a shell, a remote that works, a remote that fails on purpose, a box to paste
a URL into — and a container, with a button that updates it in place.
`remote-charts/` beside it is the same container as an Rsbuild build.
