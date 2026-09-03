[![Datalayer](https://assets.datalayer.tech/datalayer-25.svg)](https://datalayer.io)

# ⚛️ Federation — plugins that arrive from a URL

Every other example bundles its plugins. This one fetches them, and exists to
answer the three questions that raises.

```bash
npm run build          # from the repository root, to build the runtime
cd examples/federation
npm install
npm run dev            # http://localhost:5180
```

No design system and no backend: a store full of cards would be a bigger thing
to read than the subject.

## What it shows

**1. A remote is listed before it is fetched.** `@remote/greeting` has a name, a
description and a switch on the first frame, while its module is still on the
wire. That is the manifest/entry-point split — everything a host needs is
declared on the reference, not inside the module.

**2. A bad remote costs one plugin.** `@remote/broken` throws *while its module
evaluates*, which is the worst case because the request succeeded and nothing
about the URL predicted it. The platform carries on, and the row says why:

```
@remote/broken   this remote is broken on purpose      failed
```

**3. A plugin can arrive that nothing named.** Paste a URL into the box and
`reactor.install()` puts it into the running platform. `/remotes/late.js` is
referenced by no code in this application and is not in its plugin list. That is
a marketplace install with the marketplace removed — and nothing already running
is restarted.

Try an absolute URL on another origin. It is refused, and says so: a remote runs
with this page's privileges, so "anywhere" is not a default anybody should get
by accident.

## How the remotes are written

`public/remotes/*.js` are plain ES modules with **no build step**, so the
example is about federation rather than about a toolchain. Each borrows React
and the runtime from the host:

```js
const { react: React, '@datalayer/reactor': Reactor } =
  globalThis.__DATALAYER_REACTOR__.shared;
```

They may not `import 'react'`. A module fetched at runtime is not in the host's
bundle, so that import would either fail or — far worse — succeed and hand the
plugin a *second* React, whose hooks throw from inside a component that looks
perfectly fine. The host publishes its copies with `setReactorSharedModules`
(see `src/main.tsx`), and `REACTOR_SHARED_MODULES` is the floor the runtime
warns about when a host forgets.

## What is not here yet

Module Federation containers. `defineRemotePlugin` takes a `loader`, and the
default one is a dynamic `import()` of a URL — so moving to MF's `loadRemote`
is one function, not a rewrite. See [REACTOR.md](../../REACTOR.md) §3 and
[the roadmap](https://reactor.datalayer.tech/roadmap/federation).
