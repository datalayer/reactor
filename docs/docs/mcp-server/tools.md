---
sidebar_position: 1
title: Tools
---

# A tool is a contribution

An extension offers its tools; the host collects them and builds a server.
Nothing in an extension holds a server object, which is what lets the same
extension be served to a client that asked for its toolset and be absent for
one that did not — without the extension knowing either happened.

## Offering one

The `@tool` decorator marks a method, and the base class collects every marked
method:

```python
from reactor import PluginManifest
from reactor_mcp_server import McpExtension, tool


class Sandboxes(McpExtension):
    def manifest(self) -> PluginManifest:
        return PluginManifest(name="sandboxes", version="1.0.0")

    @tool(title="Launch Sandbox")
    async def launch_sandbox(self, sandbox_name: str, variant: str = "eval") -> dict:
        """Launch a sandbox for this session to run code in."""
        return await launch(sandbox_name, variant)
```

The function is returned unchanged and stays callable — a tool is an ordinary
function that something else decided to publish, and a test should be able to
call it without a server.

For tools built at run time — read from a catalogue, generated per
deployment — override `tools()` and return the specs:

```python
from reactor_mcp_server import ToolSpec


class Sandboxes(McpExtension):
    def tools(self) -> list[ToolSpec]:
        return [
            ToolSpec(
                name="launch_sandbox",
                handler=launch_sandbox,
                annotations=LAUNCH_SANDBOX_ANNOTATIONS,
            ),
        ]
```

The two styles mix: `tools()`'s default *is* the decorator collection, so
overriding it replaces that, and a subclass that wants both returns
`[*super().tools(), *more]`.

## What a `ToolSpec` carries

| Field | What it is |
| --- | --- |
| `name` | What a client calls it. Unique across the server it is built into. |
| `handler` | The implementation. Sync or async — the SDK takes either. |
| `description` | What a model reads. Empty falls back to the handler's docstring, so the description and the code cannot drift. |
| `title` | A human-readable name for a client's UI. |
| `annotations` | `mcp.types.ToolAnnotations` — read-only, destructive, idempotent, open-world. |
| `toolset` | Which named group it belongs to. Empty means the extension's own. |
| `meta` | Anything the host should carry but not interpret — a policy, a scope. |

`annotations` is what a client reads to decide whether to ask the person
first, and whether a call that timed out is safe to send again. Left unset,
the cautious defaults answer: not idempotent, open world. Those are the wrong
answers for a listing.

## Where the description comes from

```python
@tool()
async def read_cell(self, index: int) -> dict:
    """Read one cell of the notebook in use, with its outputs."""
```

That docstring is the description a model sees. Passing `description=` to
`@tool` or `ToolSpec` overrides it, which is what an extension does when the
text a model needs is not the text a reader of the code needs.

## Putting them on a server by hand

A test, a script, or a deployment that builds one server and keeps it should
put a tool on it the way the host does, or the thing it exercises is not the
thing that is served:

```python
from mcp.server.mcpserver import MCPServer
from reactor_mcp_server import put_on_server

server = MCPServer("probe")
put_on_server(server, Sandboxes().tools())
```

## The contribution point

Tools are contributed at `mcp.tools`, each under its own name:

```python
from reactor_mcp_server import TOOLS

for contribution in platform.get_contributions(TOOLS):
    print(contribution.plugin, contribution.value.name)
```

Contributing *under the name* is what lets another extension extend it by
name. That is the next page.
