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
This is what Module Federation's `shared` does, with the machinery removed.
`defineRemotePlugin` takes a `loader`, so swapping `import(url)` for
`loadRemote()` when [federation lands](/roadmap/federation) is one function, not
a rewrite.
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
is a shell, a remote that works, a remote that fails on purpose, and a box to
paste a URL into.
