<!--
  Copyright (c) 2026-Present Datalayer, Inc.

  Datalayer License
-->

[![Datalayer](https://assets.datalayer.tech/datalayer-25.svg)](https://datalayer.io)

# Toolsets Example

Two toolsets for [`reactor_mcp_server`](../../apps/mcp-server), in one
distribution:

| Toolset | Tools | Served |
| --- | --- | --- |
| `math` | `add`, `multiply` | To everybody — on by default |
| `geo` | `get_capital_of_country`, `get_country_of_capital` | To a client that asks — `?geo` — and its extension is not woken until one does |

Each is an `McpExtension`: a manifest, one `Toolset`, and tools written as
methods with `@tool`. See [`reactor_mcp_toolsets_example/math.py`](./reactor_mcp_toolsets_example/math.py)
and [`reactor_mcp_toolsets_example/geo.py`](./reactor_mcp_toolsets_example/geo.py).

## Run it

Installed, the two extensions are found by any host through their entry points
— the generic `reactor-mcp-server` command here:

```bash
pip install -e "examples/mcp-toolsets[server]"
reactor-mcp-server --port 4040
```

Or, without installing anything, from code:

```bash
python examples/mcp-toolsets/serve.py
```

Then ask with the URL:

| URL | Tools |
| --- | --- |
| `http://localhost:4040/mcp` | `add`, `multiply`, `list_server_toolsets` |
| `http://localhost:4040/mcp?geo` | the above, and the two `geo` tools |
| `http://localhost:4040/mcp?only=geo` | the `geo` tools, and `list_server_toolsets` |
| `http://localhost:4040/mcp?without=math` | `list_server_toolsets` alone |

```bash
curl -s "http://localhost:4040/toolsets?geo" | python -m json.tool
```

`list_server_toolsets` is the same answer as a tool, for a model in a session to find
out that `geo` exists and how to ask for it.

## Over stdio

A client that launches the server has no URL; the command line selects:

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

## Test it

```bash
pip install -e "examples/mcp-toolsets[test]"
pytest examples/mcp-toolsets/tests -v
```
