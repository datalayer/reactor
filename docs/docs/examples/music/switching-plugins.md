---
sidebar_position: 3
title: Switching Plugins Off
---

# Switching plugins off and on

The **Plugins** sidebar has a switch per plugin, frontend and backend alike. Both
kinds are live — nothing restarts, and no page reloads.

Try it in the [live demo](/examples/music/demo).

| Uncheck | What happens | Why |
| --- | --- | --- |
| `@music/mood` (frontend) | the playlist's chooser empties | disabling a plugin withdraws its contributions, so the rules leave the point |
| `@music/checkout` (frontend) | both Checkout buttons go, and the page with them | nothing draws them but the checkout plugin — the header and the shop only offer the slot |
| `@music/playlist` (frontend) | the playlist card disappears | its slot component goes with it, while mood's contributions sit unused |
| `catalog` (Python) | catalog **and** shop disappear | both React plugins declare `requiredBackendPlugins: ['catalog']` |
| `playlist` (Python) | the playlist card stays, and says so | the frontend declares it in `optionalBackendPlugins`, which never gates rendering |
| `mood` (Python) | `GET /api/playlist/rules` returns `[]` | the platform stops counting a disabled plugin's contributions |

Hovering a row opens an overlay with what that plugin says about itself — its
icon and emoji, display name, identifier, tier, description, and the plugins it
requires or merely likes on the other side of the wire. Both tiers declare the
same four presentation fields, which is why one overlay draws either.

## Two mechanisms with nothing in common

- **Frontend (TypeScript)** — `reactor.enable(name)` / `reactor.disable(name)`
  on the platform in the browser. That is every reactor's business rather than
  this example's, so [`@datalayer/reactor-manager`](/core-plugins/manager) does it.
- **Backend (Python)** — `POST /plugins/{name}/toggle` on the reactor's
  [management API](/python-plugins/http-api). The frontend does not decide this; it asks
  the server and re-reads `GET /plugins`. Nothing generic can know that endpoint
  exists, which is why the example's own panel still does.

The two meet in `requiredBackendPlugins`: a React plugin that declares one stops
rendering when that backend plugin is switched off.

The panel never lists itself: a panel that can switch itself off cannot switch
itself back on.

## Against the real server

The backend half is worth trying with `curl` too, to see that the server really
changed its mind rather than the browser hiding something:

```bash
curl -s localhost:8799/api/playlist/rules            # chill, energetic, a-to-z
curl -s localhost:8799/plugins/mood/toggle \
  -H 'content-type: application/json' -d '{"enabled": false}'
curl -s localhost:8799/api/playlist/rules            # []
```
