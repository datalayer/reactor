---
sidebar_position: 3
title: Frontend + backend
---

# The frontend + backend example

`examples/frontend-backend` — the same two plugins, plus the wire.

A FastAPI application built with `create_reactor_app` serves the reactor's
management API; the frontend passes an `isBackendPluginAvailable` predicate to
`useReactor`, and a slot component declaring `requiredBackendPlugins` stops
rendering when its backend plugin is switched off.

```bash
npm run build                        # from the repository root
pip install -e .
uvicorn examples.frontend_backend.reactor_demo:app --reload
npm run example:dev:frontend-backend
```

This is the two-tier contract at its smallest. See
[Across the tiers](/cross-tier/declaring-dependencies) for what is being
declared, and [the music example](/examples/music/) for the same idea with four
backend plugins and a panel to switch them.
