# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""An extensible MCP server built on Reactor.

Three ideas, and the rest follows:

* **A tool is a contribution.** An extension offers tools at a contribution
  point instead of registering them on a server object, so what a server is
  made of can be read before one is built.
* **A contribution can be extended.** An extension may narrow, wrap or
  re-describe a tool another extension offered, by name and in a declared
  order — rather than registering a tool of the same name and hoping to load
  second.
* **The URL decides what is served.** Tools belong to named toolsets, and a
  client says which ones it wants in the URL it connects to:
  ``https://mcp.example.com/mcp?benchmarks``.

@module reactor_mcp_server
"""

from reactor_mcp_server.app import ToolsetRouter, create_mcp_app
from reactor_mcp_server.extension import (
    McpExtension,
    load_extensions,
    manifest_of,
)
from reactor_mcp_server.points import (
    ENTRY_POINT_GROUP,
    PROMPTS,
    RESOURCES,
    TOOLS,
    TOOLSETS,
    on_toolset,
)
from reactor_mcp_server.server import (
    BuiltServer,
    McpHost,
    build_host,
    put_on_server,
)
from reactor_mcp_server.tools import (
    Handler,
    ToolExtension,
    ToolSpec,
    Wrapper,
    resolve,
    tool,
    tool_spec_of,
)
from reactor_mcp_server.toolsets import (
    Selection,
    Toolset,
    activation_key,
    active_toolsets,
    parse_selection,
    unknown_names,
)

try:
    from importlib.metadata import version as _distribution_version

    __version__ = _distribution_version("reactor_mcp_server")
except Exception:  # pragma: no cover - not installed as a distribution
    __version__ = "1.0.4"

__all__ = [
    "BuiltServer",
    "ENTRY_POINT_GROUP",
    "Handler",
    "McpExtension",
    "McpHost",
    "PROMPTS",
    "RESOURCES",
    "Selection",
    "TOOLS",
    "TOOLSETS",
    "ToolExtension",
    "ToolSpec",
    "Toolset",
    "ToolsetRouter",
    "Wrapper",
    "__version__",
    "activation_key",
    "active_toolsets",
    "build_host",
    "create_mcp_app",
    "load_extensions",
    "manifest_of",
    "on_toolset",
    "parse_selection",
    "put_on_server",
    "resolve",
    "tool",
    "tool_spec_of",
    "unknown_names",
]
