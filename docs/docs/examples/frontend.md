---
sidebar_position: 3
title: Frontend
---

# The frontend example

`examples/frontend` — the smallest thing that is still a platform.

Two plugins, each contributing one component to a slot, mounted by an
application that only calls `useReactor` and renders `ReactorSlot`. There is no
backend, no extension and no laziness: it exists so the shape is visible without
anything else in the way.

```bash
npm run build          # from the repository root
npm run example:dev
```

| File | What it shows |
| --- | --- |
| `src/plugins/welcomeCardPlugin.tsx` | `definePlugin` with a slot component |
| `src/plugins/statusBannerPlugin.tsx` | a second plugin in the same slot |
| `src/App.tsx` | `buildReactorFromPlugins`, `useReactor`, `ReactorSlot` |

Read [Plugins](/typescript-plugins/plugins) and [React bindings](/typescript-plugins/react)
alongside it.
