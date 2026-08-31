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
| [Music store](/examples/music/) | both | The full model: slots, a contribution point, an extension, a lazy plugin, and a checkbox per plugin on both tiers. **[Runs on this page.](/examples/music/demo)** |
| [Frontend](/examples/frontend) | TypeScript | The smallest thing that is still a platform: two plugins and a slot. |
| [Frontend + backend](/examples/frontend-backend) | both | The same, with a FastAPI backend and a gated slot. |
| [CLI](/examples/cli) | Python | A command-line host extended by a plugin, with no browser anywhere. |

Start with the [music store demo](/examples/music/demo) if you want to see the
model rather than read it — the Plugins panel on its right switches any plugin
off while it runs, on either tier.
