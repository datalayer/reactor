---
sidebar_position: 1
title: Loading Extensions via Federation
---

# Loading extensions via federation

**Tracking: [datalayer/reactor#9](https://github.com/datalayer/reactor/issues/9)**

## Status: loading a remote at runtime has landed

:::tip Shipped
`defineRemotePlugin` fetches a plugin's module from a URL, `reactor.install()`
adds one to a platform that is already running, and a refused or broken remote
costs one plugin and says why. See [Remote plugins](/typescript-plugins/federation).

What is still open is below: **Module Federation containers** rather than plain
ES modules — shared-dependency negotiation, remote type hints, and hot updates
for consumed remotes. The loader is a seam, so that is a swap rather than a
rewrite.
:::

## The problem

Every frontend plugin in Reactor today is an npm dependency of the application
that mounts it. `buildReactorFromPlugins([HeaderPlugin, StoreExtension])` is a
`import`, which means the set of plugins is fixed when the shell is built.

That is fine for an application whose plugins ship with it. It is not enough for
the [things this project targets](/overview/why): a third-party ecosystem, a
marketplace, tenant-specific activation. All three require a plugin that the
person who built the shell has never heard of.

## What already points the right way

The parts of the model that make this tractable are already in place, and they
were designed for it:

- **A manifest is readable without running anything.** A plugin can be listed,
  described, drawn and switched off before its code exists locally. A remote
  changes *where the module comes from*, not what a host knows about it.
- **[`defineLazyPlugin`](/typescript-plugins/lazy-loading) already defers a module.**
  `load: () => import('./heavy')` is a thunk. A federated remote is the same
  thunk with a different body.
- **[Activation events](/typescript-plugins/activation-events) already gate the fetch.**
  A remote that is never wanted is never downloaded, with no extra machinery.

So the missing piece is delivery, not lifecycle.

## The build tool: Rsbuild on Rspack

Decided, and the repository is migrating to it — the examples and this
documentation site included. Recorded here because it is a decision and not a
preference:

> If Module Federation is a core architectural requirement → pick
> Rsbuild/Rspack.

Rspack has a mature, first-class Module Federation integration, including shared
dependencies, remote types and hot updates for consumed remotes. Vite's official
Module Federation integration works, but remote-module hot updates are still
listed on its roadmap.

Rsbuild rather than raw Rspack: Rsbuild is essentially the Vite-like application
build tool built on top of Rspack — sensible defaults, dev server, framework
plugins. Rspack itself is closer to the underlying bundler, analogous to using
webpack directly.

```
New frontend project
        │
        ├── Module Federation / microfrontends?
        │          │
        │          YES ──► Rsbuild + Rspack
        │
        ├── Migrating from webpack?
        │          │
        │          YES ──► Rsbuild + Rspack
        │
        └── Normal SPA / React / Vue / Svelte?
                   │
                   └─────► Vite 8
```

One thing the choice deliberately does **not** decide: what
`@datalayer/reactor` itself depends on. Module Federation's runtime is a
standalone SDK that needs no bundler, so the runtime loads a remote through
that and stays consumable by a host built with something else. A plugin
platform that dictated a bundler to third parties would be making the same
mistake as one that dictated a UI kit — the claim
[the CMS example](/examples/cms/) exists to test, and passes.

## What has to be designed

- **A remote reference.** Something like `defineRemotePlugin({ name, url,
  scope, module, …manifest })` — carrying the full manifest, since the whole
  point is that the host can describe the plugin before fetching it.
- **Shared singletons.** React, the reactor itself, and the design system must
  be shared, or a remote gets a second React and its hooks throw. The manifest
  is the natural place to declare what a remote expects to share.
- **Version compatibility.** The Python tier already has
  `PluginCompatibility(api_version=…)`; a remote loaded at runtime needs the same
  check, and needs it to *fail politely* — a bad remote should be one missing
  plugin, exactly as [a module that fails to load is today](/typescript-plugins/lazy-loading).
- **Trust.** A remote is third-party code in the shell's origin. What a
  marketplace listing has to assert before a host will load it is an open
  question, not an implementation detail.

## Related

Delivering the *server* half of the same extension is
[#12](/roadmap/python-packaged-extensions), and the two are meant to compose:
one install, both tiers, loaded at runtime.
