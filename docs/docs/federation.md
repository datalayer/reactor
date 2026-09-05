---
sidebar_position: 7
title: Federation
---

# Loading extensions via federation


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

## How each question was answered

- **A remote reference.** `defineRemotePlugin({ name, entry, …manifest })` for a
  plain module and `defineFederatedPlugin({ …, scope, module })` for a
  container — both carry the full manifest, so a host describes the plugin
  before fetching it. See [Remote plugins](/typescript-plugins/federation).
- **Shared singletons.** `setReactorSharedModules` publishes the host's copies;
  `initReactorFederation` turns them into a negotiated offer with versions for
  containers. See [Containers](/typescript-plugins/federation#containers).
- **Version compatibility.** `REACTOR_API_VERSION` refuses a remote built
  against another runtime, and a container's `requiredVersion` is answered per
  module — both politely, as a listed plugin with a reason.
- **Trust.** Still open. `allowedOrigins` is the floor; what a marketplace
  listing must assert, and how a host verifies it, is recorded on the
  [roadmap](/roadmap/).

## Related

Delivering the *server* half of the same extension is
[Python-packaged extensions](/python-packaged-extensions), and the two
compose: one install, both tiers, loaded at runtime.
