---
sidebar_position: 0
title: MCP Toolsets
slug: /examples/toolsets/
---

# The toolsets example

`examples/toolsets` — two MCP toolsets in one wheel, served by any
[`reactor_mcp_server`](/mcp-server/) host.

An MCP extension is a reactor plugin whose contributions are tools. This
example is two of them, each declaring one toolset, and the smallest amount of
code that shows the two ways a toolset is served: to everybody, or only to the
client that asks.

| Toolset | Tools | Served |
| --- | --- | --- |
| `math` | `add`, `multiply` | To every client — on by default, with instructions for the model |
| `geo` | `get_capital_of_country`, `get_country_of_capital` | Only to a client that asks with `?geo` — and its extension is not even woken until one does |

## Run it

Installed, the two extensions are found through their entry points by the
generic `reactor-mcp-server` command. Nothing names them:

```bash
pip install -e "examples/toolsets[server]"
reactor-mcp-server --port 4040
```

Or from code, with nothing installed but the server:

```bash
python examples/toolsets/serve.py      # http://localhost:4040/mcp
```

Then choose with the URL an MCP client connects to:

| URL | Tools |
| --- | --- |
| `http://localhost:4040/mcp` | `add`, `multiply`, `list_server_toolsets` |
| `http://localhost:4040/mcp?geo` | the above, and the two `geo` tools |
| `http://localhost:4040/mcp?only=geo` | the `geo` tools, and `list_server_toolsets` |
| `http://localhost:4040/mcp?without=math` | `list_server_toolsets` alone |

`/toolsets` answers the same question over plain HTTP, without opening an MCP
session:

```bash
curl -s "http://localhost:4040/toolsets?geo" | python -m json.tool
```

A client that launches the server itself has no URL, so the command line
selects:

```json
{
  "mcpServers": {
    "toolsets-example": {
      "command": "reactor-mcp-server",
      "args": ["--transport", "stdio", "--toolsets", "geo"]
    }
  }
}
```

## What is in it

| File | What it shows |
| --- | --- |
| `reactor_toolsets_example/math.py` | An `McpExtension` with one `Toolset` — title, description, instructions — and two `@tool` methods annotated as pure functions |
| `reactor_toolsets_example/geo.py` | The same, opt-in: `default=False` keeps its tools off a bare `/mcp`, and `activation_events=[on_toolset("geo")]` keeps the extension asleep until a URL names it |
| `pyproject.toml` | Both extensions published on the `reactor.mcp.extensions` entry-point group — installing the wheel is publishing them |
| `serve.py` | The host built in code: `build_host([...], toolsets_tool=True)` and `create_mcp_app` |
| `tests/test_toolsets.py` | The toolsets as a client sees them — in process, over HTTP with a real MCP client, and over stdio through the entry points |

The core of `geo.py`:

```python
class GeoExtension(McpExtension):
    def manifest(self) -> PluginManifest:
        return PluginManifest(
            name="geo",
            version="0.1.0",
            activation_events=[on_toolset("geo")],
        )

    def toolsets(self):
        return (Toolset(name="geo", title="Geography", default=False),)

    @tool(title="Get Capital of Country", annotations=LOOKUP)
    async def get_capital_of_country(self, country: str) -> str:
        """Return the capital city of a country, by the country's English name."""
        ...
```

## Test it

```bash
pip install -e "examples/toolsets[test]"
pytest examples/toolsets/tests -v
```

The stdio test runs only when the example is installed, since that is how the
command finds the extensions; CI installs it.

## Where to read more

- [Example toolsets](/mcp-server/example-toolsets) walks the same two
  extensions through the MCP server's model, with the exchange a client has
  when it discovers `geo` and reconnects for it.
- [Toolsets](/mcp-server/toolsets) is the URL grammar, instructions,
  `list_server_toolsets` and what a deployment decides.
- [Serving](/mcp-server/serving) lists every option of `reactor-mcp-server`.

The same shape serves real data: [NASA Earthdata](https://github.com/datalayer/earthdata-mcp-server)
ships an opt-in `earthdata` toolset, and installing it beside any host serves
it at `/mcp?earthdata`.
