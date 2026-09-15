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
| `admin` | ✓ | ✓ | ✓ | Users, roles, sites and themes |

Authorization is checked in the Python API. Hiding the Users, Sites, Appearance and
Extensions navigation for non-admins is a usability choice, not the security
boundary.

The Sites view includes a General editor for the website identity and an
Appearance editor using Primer Addons. Application color mode and Primer theme
preferences remain personal, while the selected public website theme is stored
on the site and used by Astro for every visitor. Public pages consume Primer's
functional CSS variables directly, including automatic light and dark modes.

## Lexical authoring

The Content view embeds a Lexical composer with rich-text, history and change
plugins. The example toolbar provides bold, italic and underline formatting.

On every editor update the application derives two representations:

- `data.lexical`: serialized Lexical JSON, used to reopen the rich editor
  without losing formatting;
- `body`: plain text, used by SQLite FTS5 and clients that do not understand
  Lexical nodes.

Older entries that contain only `body` are imported into a paragraph when the
editor opens. Saving them adds the Lexical representation without discarding
their original text.

Authors see only entries they own. An editor or administrator can work with all
entries on the site. Publishing creates a revision so the previous state remains
available through the revisions endpoint.

## Relevant endpoints

| Endpoint | Minimum role |
| --- | --- |
| `GET /api/cms/sites/{site}/entries` | `viewer` |
| `POST /api/cms/sites/{site}/entries` | `author` |
| `PATCH /api/cms/sites/{site}/entries/{entry}` | owner `author`, or `editor` |
| `POST /api/cms/sites/{site}/entries/{entry}/publish` | owner `author`, or `editor` |
| `GET /api/cms/sites/{site}/users` | `admin` |
| `PATCH /api/cms/sites/{site}/users/{user}` | `admin` |
| `DELETE /api/cms/sites/{site}/users/{user}` | `admin` |
| `PUT /api/cms/sites/{site}/memberships` | `admin` |
| `PATCH /api/cms/sites/{site}/theme` | `admin` |
| `PATCH /api/cms/sites/{site}/appearance` | `admin` |
