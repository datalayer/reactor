---
sidebar_position: 11
title: Allowed Origins
---

# Where a remote is allowed to come from

A [remote plugin](/typescript-plugins/federation) is a module fetched at
runtime and run in the page. Not beside the page, not in a frame — *in* it,
with the shell's cookies, the shell's session, the shell's access to every API
the shell can reach, and a paintbrush over the shell's own DOM.

So a URL is not a delivery detail. It is the trust boundary, and the whole of
it. That is why the rule is one sentence:

> **The page's own origin always passes. Every other origin has to be named.**

Nothing loads from an origin a host did not name, and *"anywhere"* is not
something anybody gets by accident.

## Naming one

Once, for the page, from the shell — beside `setReactorSharedModules`, before
anything loads:

```ts
import { setAllowedOrigins } from '@datalayer/reactor';

setAllowedOrigins([
  'https://plugins.example.com',
  'https://*.cdn.example.com',
]);
```

Or for one plugin, where it is declared:

```ts
defineRemotePlugin(ref, { allowedOrigins: ['https://plugins.example.com'] });
defineFederatedPlugin(ref, { allowedOrigins: ['https://cdn.acme.com'] });
```

The two **add together**, and only ever widen: a per-plugin list allows one
more origin for that plugin, and cannot take away what the page allowed.
A policy that changed depending on which call site loaded a module would not be
a policy, and a caller that could tighten the page's list could equally have
been trusted to write it.

| Written | Matches |
| --- | --- |
| `https://cdn.acme.com` | exactly that origin |
| `https://cdn.acme.com/` or `…/path` | the same — it is read as an origin |
| `https://*.acme.com` | `cdn.acme.com`, `a.b.acme.com` — **not** the apex, and not `evilacme.com` |
| `*` (`ANY_ORIGIN`) | everything. Development only; see below |

Scheme and port are part of an origin, so they are part of the match:
`https://*.acme.com` does not match `http://cdn.acme.com` or
`https://cdn.acme.com:8443`. The wildcard means what it means in a
Content-Security-Policy source, deliberately — the two lists must not disagree.

An entry that cannot be read is dropped with a named warning, and the origin
stays refused. `'cdn.acme.com'` without a scheme is the common way to write
this wrong; it fails **closed** and says which entry it was, rather than taking
the shell down at module scope over a misplaced character.

## Every door, not the front one

A URL turns into code in more places than `defineRemotePlugin`, and a gate on
one of them is a gate with the others left open. All four go through the same
policy:

| Where a URL becomes code | What is checked |
| --- | --- |
| `defineRemotePlugin` / `defineFederatedPlugin` | the entry, when the module is fetched — not at declaration, so a plugin that is never activated is never checked and never fetched |
| `registerFederatedRemote` | the container entry, before the federation runtime is told about it |
| `updateFederatedRemote` | the same, on every [hot update](/typescript-plugins/federation#hot-updates) |
| `bootstrapExtensions` | every entry the server lists |

The hot-update row is the one worth pausing on. It is the only call that takes
a URL **from a person** — a console, a dev server, a marketplace saying *"a new
version is available"* — and hands it the name of a container the host already
trusts. A policy that covered the declaration and not the update would be
protecting the door while leaving the window open.

## The backend you pointed at is a named origin

```ts
const remotes = await bootstrapExtensions('http://localhost:8799');
```

That is enough. `backendUrl` is written in the host's own source, which *is*
naming the origin, so a shell on `:3000` reading extensions from a server on
`:8799` writes no allow-list at all.

What it does not extend to is an entry that server points somewhere else: a
record whose `entry` is an absolute URL on a third origin is checked like any
other remote. The origin a host named is **the server, not everywhere the
server can point** — otherwise one trusted backend would be a way to launder
every other origin on the internet.

## Asking before you offer

The load-time check is the one that matters, and its refusal is a
[state, not a crash](/typescript-plugins/federation#a-refusal-that-is-not-a-crash):
the plugin stays listed with `loadError` explaining that its origin was not
allowed. That is right for a plugin a host declared, and wrong for a
marketplace — letting somebody install something and *then* showing them an
error makes a policy look like a breakage.

So ask first:

```tsx
import { isOriginAllowed } from '@datalayer/reactor';

<button disabled={!isOriginAllowed(url)} onClick={install}>Install</button>
```

The [federation example](https://github.com/datalayer/reactor/tree/main/examples/federation)
does exactly this in its paste-a-URL box.

For the refusals that do happen at load time, `OriginNotAllowedError` is
exported and carries the `origin` it refused, so a host can tell a refused
origin from a network that was down without matching on the text of a message.

## Why a resolved origin and not a pattern on the string

Because *"does this look absolute?"* has a wrong answer:

```ts
defineRemotePlugin({ name: '@x/y', entry: '//evil.example/x.js' });
```

`//evil.example/x.js` is **protocol-relative**. A `^[a-z]+://` test says it is
a local path; the browser loads it from `evil.example`. Every URL is therefore
resolved against the page — `new URL(entry, location.href).origin` — because
that is the only way to learn where an import would actually go.

Two consequences fall out of the same decision. A `data:` URL serialises to the
opaque origin `null`, which is not an origin anybody can name, so it cannot be
allowed by naming one. (A `blob:` URL is not that: it carries the origin of the
page that made it, so a page's own blob is same-origin and passes — which is
right, because the page made it.) And when there is no page to resolve against
— a test, a server-side render — a relative URL has no origin, nothing a check
could protect, and is left alone.

## It is a gate, not a sandbox

Refusing an origin stops **Reactor** from fetching a module. It does not stop
code that *is* loaded from fetching whatever it likes afterwards; a container's
own chunks are fetched by the federation runtime, and a module that has run can
`import()` anything. Nothing inside a page can prevent that.

What can is the browser. The allow-list should therefore be written into a
Content-Security-Policy, and — so the two cannot drift — from the same list:

```ts
response.setHeader(
  'Content-Security-Policy',
  `script-src ${scriptSrcForAllowedOrigins()}`,
);
// script-src 'self' https://plugins.example.com https://*.cdn.example.com
```

`'self'` comes first, because same-origin always passes.

## `ANY_ORIGIN`, and why it is spelled out

```ts
setAllowedOrigins([ANY_ORIGIN]);   // '*' — a development shell, and nothing else
```

A plugin author trying two dev servers and a tunnel does not want to maintain a
list, and someone who cannot say *"allow everything"* in the API will say it by
reaching around the check instead — which leaves nothing to grep for. So it is
a constant with a name, it is never a default, and a production host that finds
it in its own source has found a bug. `scriptSrcForAllowedOrigins()` answers
`*` for it, which is a CSP that permits everything and should look like one.

## What is still open

Origin is a statement about **where** a module is served from, and that is a
real answer to a real question — it is what stops a compromised listing, a
mistyped URL or a stray `//host` from putting somebody else's code in your
page. It is not a statement about **what** the module is, or who wrote it.

Two things are undecided, and both belong to a marketplace rather than to the
runtime:

- **What a listing must assert.** A publisher identity, a signature over the
  entry, a hash of the module — something a host can check that survives the
  origin being right and the bytes being wrong.
- **How a host verifies it.** Subresource integrity covers a fixed entry and
  says nothing about the chunks a container fetches afterwards; a signature
  needs a key somebody distributes, and distributing keys is the whole problem
  again one layer down.

Until that is decided, an origin is a host's statement that it trusts whoever
operates that server to serve it code — which is exactly what loading a script
from a CDN has always meant, said out loud and checked. The
[federation design page](/federation/) records this as the open item it is.
