---
sidebar_position: 4
title: AI-assisted Publishing
---

# AI-assisted publishing

The published Astro website mounts an **Astro CMS Author** with
`ChatFloating`. The island first validates the `cms-session` bearer token and
checks that its user belongs to the site being rendered. Without that
membership it renders nothing and does not load the larger agent bundle.

The loop runs in the browser. `useBrowserInference` obtains a short-lived
anonymous inference key, and `AnonymousKeyTimer` is passed to the chat through
its header props. The timer describes only model access. Create and update
requests carry the independent CMS bearer token and remain subject to the
Python API's `viewer`, `author`, `editor`, and `admin` checks.

## Agent spec

The source of truth is
`agent-runtimes/agentspecs/agentspecs/agents/worker-cms-astro.yaml`. It owns the
model, system prompt, welcome message, and suggestions, including an opener for
`https://openteams.com/blog`. After editing it, regenerate both language
catalogues from the top of `agent-runtimes`:

```bash
make specs
```

The Astro component resolves the generated `worker-cms-astro` spec. It does
not repeat the model identifier in application code.

## Frontend tools

Core contributes one `AgentTools` bundle with four commands:

| Tool | Effect |
| --- | --- |
| `cms_crawl_blog` | Follows same-origin content links from any public blog index |
| `cms_crawl_wordpress` | Discovers `https://api.w.org/` metadata and reads `wp/v2/posts?_embed=1` |
| `cms_create_site_page` | Creates a post or page as a draft, optionally publishing it |
| `cms_update_site_page` | Updates an exact entry ID or current slug, optionally publishing it |

The agent spec intentionally leaves `frontend_tools: []`: following the
[Reactor agent-tools contract](/agent-tools/), a plugin declares its own
capabilities and a host supplies their live handlers. The browser protocol
receives those handlers directly so tool calls run on the page the author is
viewing.

The crawl handlers call authenticated FastAPI endpoints instead of fetching
third-party pages from the browser, where CORS would make general crawling
unreliable. The server accepts only public HTTP(S) hosts, rejects local and
reserved address ranges, revalidates redirects, and bounds response sizes.
WordPress crawling prefers the public REST metadata; generic crawling uses
same-origin links under the blog path.

## Private-content boundary

Crawl tools return public web content. Write tools return only the resulting
entry ID, slug, status, and public path. They do not enumerate or send existing
private CMS bodies to the anonymous inference service. Updating by slug is
resolved on the server and requires an exact slug already supplied by the
author.

Published standalone pages are rendered by Astro at `/pages/{slug}`; posts use
`/posts/{slug}`. Bulk imports default to drafts unless the author explicitly
asks the agent to publish.
