---
sidebar_position: 5
title: HTTP API
---

# HTTP API

`create_reactor_app(platform)` returns a FastAPI application serving the
reactor's own control plane. Your plugins' routers are mounted on top of it.

## Plugins and extensions

| Endpoint | What it answers |
| --- | --- |
| `GET /plugins` | every plugin, its presentation metadata, and whether it is enabled and activated |
| `GET /extensions` | every extension and the plugins it delivered |
| `POST /plugins/{plugin_name}/toggle` | enable or disable one at runtime |
| `POST /plugins/{plugin_name}/deactivate` | stand a plugin down, dependants first |
| `POST /events/{event}` | fire an event; answers with what stood down and what woke |
| `GET /plugins/state` | the revision, and each plugin's `enabled`/`activated` — the cheap poll |
| `GET /events/stream` | server-sent events: one message whenever the platform changes |
| `GET /plugins/frontend-extensions` | every installed [extension's](/python/packaging) frontend half, rescanned |
| `GET /reactor-extensions/{name}/{path}` | that extension's files, out of the installed distribution |

## Across the tiers

| Endpoint | What it answers |
| --- | --- |
| `GET /plugins/frontend-requirements?active=a,b` | what enabled plugins ask of the frontend, and what of it is missing |

## Tenants and marketplace

| Endpoint | What it answers |
| --- | --- |
| `POST /tenants/plugins/{plugin_name}/toggle` | enable or disable for one tenant |
| `GET /tenants/{tenant_id}/features` | what that tenant may use |
| `GET /tenants/{tenant_id}/routes` | the routes that follow from it |
| `GET /marketplace` | what is publishable and published |

## Trying it

The [music example](/examples/music/switching-plugins) drives most of these from
a browser, and the same calls answer `curl` — which is the honest way to see that
the server really changed its mind rather than the browser hiding something:

```bash
curl -s localhost:8799/api/playlist/rules            # chill, energetic, a-to-z
curl -s localhost:8799/plugins/mood/toggle \
  -H 'content-type: application/json' -d '{"enabled": false}'
curl -s localhost:8799/api/playlist/rules            # []
```
