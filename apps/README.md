<!--
  Copyright (c) 2026-Present Datalayer, Inc.

  Datalayer License
-->

[![Datalayer](https://images.datalayer.io/legacy/datalayer-25.svg)](https://datalayer.ai)

# ⚛️ Reactor Apps

Applications built on the reactor that ship as their own packages.

`plugins/` holds pieces an application installs; `apps/` holds the application
a deployment runs. An app is a host: it discovers what is installed, starts a
reactor platform with it, and serves the result — and, like a plugin, it may not
assume anything about a particular deployment beyond what it is told.

## What is here

| App | Package | What it is |
| --- | --- | --- |
| [`mcp-server`](./mcp-server) | `reactor_mcp_server` (PyPI) | An extensible MCP server: extensions offer tools, prompts and resources as contributions, and a client selects toolsets by URL. |

Each app is versioned and released with the reactor — see
[RELEASE.md](../RELEASE.md).
