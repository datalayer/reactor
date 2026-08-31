---
sidebar_position: 5
title: Federation
---

# The federation example

`examples/federation` — plugins that arrive from a URL.

Every other example bundles its plugins. This one fetches them, and exists to
answer the three questions that raises. No design system and no backend: a store
full of cards would be a bigger thing to read than the subject.

```bash
npm run build          # from the repository root
cd examples/federation && npm install && npm run dev
```

| What it shows | How |
| --- | --- |
| a remote is **listed before it is fetched** | `@remote/greeting` has a name, description and switch on the first frame, with its module still on the wire |
| a bad remote **costs one plugin** | `@remote/broken` throws while its module evaluates — the worst case, because the request succeeded — and the row says why |
| a plugin can arrive that **nothing named** | paste a URL, and `reactor.install()` puts it into the running platform without restarting anything |

Try an absolute URL on another origin: it is refused and says so, because a
remote runs with the page's privileges.

The remotes in `public/remotes/` are plain ES modules with no build step, and
borrow React from the host rather than importing it — see
[Remote plugins](/typescript/federation) for why that is not optional.
