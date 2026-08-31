---
sidebar_position: 0
title: Examples
slug: /examples/
---

# Examples

Everything here lives under `examples/` in the repository and runs against the
same two packages the rest of this documentation describes.

| Example | Tiers | What it is for |
| --- | --- | --- |
| [CMS](/examples/cms) | both | Two Python packages — free and paid — filling the same three contribution points, on shadcn/ui. The clearest statement of package → extension → plugin → contribution. |
| [Music store](/examples/music/) | both | The full model: slots, a contribution point, an extension, a lazy plugin, and a checkbox per plugin on both tiers. **[Runs on this page.](/examples/music/demo)** |
| [Frontend](/examples/frontend) | TypeScript | The smallest thing that is still a platform: two plugins and a slot. |
| [Frontend + backend](/examples/frontend-backend) | both | The same, with a FastAPI backend and a gated slot. |
| [CLI](/examples/cli) | Python | A command-line host extended by a plugin, with no browser anywhere. |
| [Federation](/examples/federation) | TypeScript | Plugins fetched from a URL: one that works, one that fails on purpose, and one installed by pasting a link. |
| [Extension](/python/packaging) | both | One `pip install` shipping a Python plugin and its UI — and appearing in a server that was already running. |

Start with the [music store demo](/examples/music/demo) if you want to see the
model rather than read it — the Plugins panel on its right switches any plugin
off while it runs, on either tier.
