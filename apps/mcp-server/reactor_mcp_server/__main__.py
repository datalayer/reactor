# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Run the installed MCP extensions as a reactor application.

``python -m reactor_mcp_server`` — or ``reactor-mcp-server`` — discovers every
extension on the ``reactor.mcp.extensions`` entry-point group, starts a reactor
platform with them, and serves them over streamable HTTP — or over stdio, to a
client that launches the server itself. A deployment adds a toolset by
installing a distribution; nothing here is edited.

``--toolsets`` says what a client that names no toolset gets, in the URL's own
spelling (``earthdata``, ``only=math,geo``); over stdio, where there is no URL,
it is the whole of the selection.

@module reactor_mcp_server.__main__
"""

from __future__ import annotations

import argparse
import logging
import os

from reactor_mcp_server.app import create_mcp_app
from reactor_mcp_server.extension import load_extensions
from reactor_mcp_server.server import build_host
from reactor_mcp_server.toolsets import parse_selection

#: Entry-point names to load, to the exclusion of everything else installed.
#: What makes a tool list reproducible on a machine that happens to carry an
#: extra extension.
EXTENSIONS_ENV = "REACTOR_MCP_EXTENSIONS"


def _flag(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() not in ("0", "false", "no", "off", "")


def parser() -> argparse.ArgumentParser:
    parsed = argparse.ArgumentParser(
        prog="reactor-mcp-server",
        description="Serve the installed MCP extensions over streamable HTTP or stdio.",
    )
    parsed.add_argument(
        "--transport",
        choices=("streamable-http", "stdio"),
        default=os.environ.get("REACTOR_MCP_TRANSPORT", "streamable-http"),
    )
    parsed.add_argument("--host", default=os.environ.get("REACTOR_MCP_HOST", "0.0.0.0"))
    parsed.add_argument(
        "--port", type=int, default=int(os.environ.get("REACTOR_MCP_PORT", "4040"))
    )
    parsed.add_argument("--path", default=os.environ.get("REACTOR_MCP_PATH", "/mcp"))
    parsed.add_argument(
        "--name", default=os.environ.get("REACTOR_MCP_NAME", "reactor-mcp-server")
    )
    parsed.add_argument(
        "--extension",
        action="append",
        default=None,
        help="Load only this extension; repeatable.",
    )
    parsed.add_argument(
        "--toolsets",
        default=os.environ.get("REACTOR_MCP_TOOLSETS", ""),
        help=(
            "What a client naming no toolset gets, in the URL's spelling: "
            "'earthdata', 'only=math,geo', 'without=geo'. Over stdio, the selection."
        ),
    )
    parsed.add_argument(
        "--ignore-query-key",
        action="append",
        default=None,
        help="A query key this deployment reads for something else; repeatable.",
    )
    parsed.add_argument(
        "--list-toolsets-tool",
        action=argparse.BooleanOptionalAction,
        default=_flag("REACTOR_MCP_LIST_TOOLSETS_TOOL", True),
        help="Put list_toolsets on every server (default: on).",
    )
    parsed.add_argument("--log-level", default=os.environ.get("REACTOR_MCP_LOG", "info"))
    return parsed


def main(argv: list[str] | None = None) -> None:
    arguments = parser().parse_args(argv)
    # Logs go to stderr: over stdio, stdout is the protocol.
    logging.basicConfig(level=arguments.log_level.upper())
    names = arguments.extension or [
        part.strip()
        for part in (os.environ.get(EXTENSIONS_ENV) or "").split(",")
        if part.strip()
    ]
    host = build_host(
        load_extensions(names or None),
        name=arguments.name,
        list_toolsets_tool=arguments.list_toolsets_tool,
    )
    selection = parse_selection(arguments.toolsets) if arguments.toolsets else None

    if arguments.transport == "stdio":
        built = host.build(selection)
        if built.unknown:
            logging.getLogger(__name__).warning(
                "Unknown toolsets: %s", ", ".join(sorted(built.unknown))
            )
        built.server.run(transport="stdio")
        return

    app = create_mcp_app(
        host,
        path=arguments.path,
        default_selection=selection,
        ignore_query_keys=arguments.ignore_query_key or (),
    )

    import uvicorn  # noqa: PLC0415 - only the serving path needs it

    uvicorn.run(app, host=arguments.host, port=arguments.port, log_level=arguments.log_level)


if __name__ == "__main__":
    main()
