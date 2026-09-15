---
sidebar_position: 3
title: Users and Authoring
---

# Users, roles and authoring

## Authentication flow

The client-side administration application posts a username and password to:

```http
POST /api/cms/auth/login
Content-Type: application/json

{"username":"user1","password":"user1"}
```

Passwords are stored as salted PBKDF2-SHA256 hashes. A successful login returns
an opaque bearer token plus the user's site memberships. The server stores only
a hash of that token and expires the session after twelve hours.

Authenticated calls send:

```http
Authorization: Bearer <token>
```

The `X-CMS-User` identity shortcut exists only for isolated tests whose host
explicitly enables it; the normal application does not trust that header.

## Site-scoped roles

| Role | Read content | Author content | Edit all content | Manage site |
| --- | ---: | ---: | ---: | ---: |
| `viewer` | ✓ | — | — | — |
| `author` | ✓ | Own entries | — | — |
| `editor` | ✓ | ✓ | ✓ | — |
| `admin` | ✓ | ✓ | ✓ | Users, roles, sites and appearance |

Authorization is checked in the Python API. Hiding the Users, Sites, Appearance
and Extensions navigation for non-admins is a usability choice, not the
security boundary. The authenticated routes are thin Astro mounts; React owns
their screens, while user-created visitor content continues to be rendered by
Astro.

The top-level Appearance screen controls only the signed-in user's CMS
application. The Sites view has a separate Appearance editor for visitors. It
offers Datalayer theme cards, an Astro layout selector, light/dark/system modes,
and a live preview of the site's homepage. The public theme and layout are stored
on the site and used by Astro for every visitor.

## Lexical authoring

The Content view recreates a CMS-specific editor from the building blocks in
`@datalayer/jupyter-lexical`. It follows the Jupyter Lexical example's rich
toolbar pattern and imports plugins for component insertion, tables and cell
resizing, table actions, code actions, comments, draggable blocks, links,
floating text formatting, and a table of contents.

Runtime/kernel and collaboration plugins are intentionally excluded because
this example does not provision their backing services. Read-only entries omit
the interactive toolbar and editing plugins.

On every editor update the application derives two representations:

- `data.lexical`: serialized Lexical JSON, used to reopen the rich editor
  without losing formatting;
- `body`: plain text, used by SQLite FTS5 and clients that do not understand
  Lexical nodes.

Older entries that contain only `body` are imported into a paragraph when the
editor opens. Saving them adds the Lexical representation without discarding
their original text.

All site members can see the existing entries, and the first entry is selected
when the Content screen opens instead of showing only an empty New Entry form.
Authors can edit and publish their own entries; another author's entry opens
read-only. Editors and administrators can edit every entry. Publishing creates
a revision so the previous state remains available through the revisions
endpoint.

While an entry is saved, the stable status flash displays a small spinner and
“Saving changes…” or “Creating draft…”. The same flash becomes the success
message, avoiding a vertical layout jump.

Public pages consume the portable theme's functional color variables and font
stacks. The selected Astro layout controls page structure but does not override
the Datalayer theme's typography.

## Relevant endpoints

| Endpoint | Minimum role | Purpose |
| --- | --- | --- |
| `GET /api/cms/sites/{site}/entries` | `viewer` | List all entries visible to the site member |
| `POST /api/cms/sites/{site}/entries` | `author` | Create an owned entry |
| `PATCH /api/cms/sites/{site}/entries/{entry}` | owner `author`, or `editor` | Update content |
| `POST /api/cms/sites/{site}/entries/{entry}/publish` | owner `author`, or `editor` | Publish and capture a revision |
| `GET /api/cms/sites/{site}/users` | `admin` | List users and memberships |
| `PATCH /api/cms/sites/{site}/users/{user}` | `admin` | Update or disable a user |
| `DELETE /api/cms/sites/{site}/users/{user}` | `admin` | Remove a site membership |
| `PUT /api/cms/sites/{site}/memberships` | `admin` | Assign a site role |
| `PATCH /api/cms/sites/{site}/theme` | `admin` | Select the Astro layout (legacy focused endpoint) |
| `PATCH /api/cms/sites/{site}/appearance` | `admin` | Save portable tokens, color mode, and optionally the layout |
