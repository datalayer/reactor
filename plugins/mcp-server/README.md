<!--
  Copyright (c) 2026-Present Datalayer, Inc.

  Datalayer License
-->

[![Datalayer](https://assets.datalayer.tech/datalayer-25.svg)](https://datalayer.ai)

# Reactor MCP Server

An extensible [MCP](https://modelcontextprotocol.io) server built on
[Reactor](https://github.com/datalayer/reactor). Three ideas, and the rest
follows from them.

## A tool is a contribution

An extension does not reach into a server and register a function on it. It
*offers* a tool at a contribution point, and the host builds a server from what
has been offered:

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

Offering rather than registering is what makes the next part possible — and it
means what a server is made of can be read, listed and drawn before one is
built.

## A contribution can be extended

An extension may narrow, wrap or re-describe a tool **another** extension
offered:

```python
class DatalayerSandboxes(McpExtension):
    def manifest(self) -> PluginManifest:
        return PluginManifest(name="sandboxes-datalayer", version="1.0.0")

    def tool_extensions(self):
        def on_datalayer(handler):
            async def narrowed(sandbox_name: str, environment: str = "ai-env") -> dict:
                return await handler(sandbox_name, variant="datalayer")
            return narrowed

        return (("launch_sandbox", ToolExtension(
            wrap=on_datalayer,
            description="Launch a sandbox on Datalayer.",
        )),)
```

Without this, an extension that wants to narrow somebody else's tool has one
lever: register a tool of the same name and hope to load second, because the
SDK keeps the first registration. That makes the outcome depend on the order
two distributions happened to be installed in — it works where the entry point
names sort the right way and silently does nothing where they do not.
Extensions are applied by name, in a declared order, on every machine.

## The URL decides what is served

Tools belong to named toolsets, and a client says which ones it wants in the
URL it connects to:

| URL | What the client gets |
| --- | --- |
| `https://mcp.example.com/mcp` | every toolset that is on by default |
| `https://mcp.example.com/mcp?benchmarks` | the defaults, and `benchmarks` |
| `https://mcp.example.com/mcp?contents,library` | the defaults, and both named sets |
| `https://mcp.example.com/mcp?toolsets=spaces,library` | the defaults, and those two |
| `https://mcp.example.com/mcp?only=spaces` | `spaces` alone, plus the always-on toolsets |
| `https://mcp.example.com/mcp?without=sandboxes` | the defaults, less that one |

A toolset that is `default=False` costs a client that did not ask for it
nothing: the extension offering it declares
`activation_events=[on_toolset("benchmarks")]` and is not registered at all
until a URL names it.

`GET /toolsets` answers what a deployment offers and what a given URL would
activate, so a client can be told which name to put in its URL.

## Running it

```bash
pip install reactor_mcp_server
reactor-mcp-server --port 4040
```

Every extension installed on the `reactor.mcp.extensions` entry-point group is
discovered, started as a reactor plugin, and served. A deployment adds a
toolset by installing a distribution:

```toml
[project.entry-points."reactor.mcp.extensions"]
sandboxes = "my_package:SandboxesExtension"
```

`REACTOR_MCP_EXTENSIONS=a,b` narrows discovery to the names it lists, which is
what makes a tool list reproducible on a machine that happens to carry an extra
extension.

## In a server of your own

```python
from reactor_mcp_server import build_host, create_mcp_app, load_extensions

host = build_host(load_extensions())
app = create_mcp_app(host, path="/mcp")
```

`McpHost` owns the reactor platform, so activation events, enablement,
per-tenant scoping and disposal work as they do for any other reactor plugin,
and a server is built once per distinct set of toolsets and shared.

## License

Datalayer License.
