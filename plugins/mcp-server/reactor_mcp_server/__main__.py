# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Run the installed MCP extensions as a reactor application.

``python -m reactor_mcp_server`` — or ``reactor-mcp-server`` — discovers every
extension on the ``reactor.mcp.extensions`` entry-point group, starts a reactor
platform with them, and serves them over streamable HTTP. A deployment adds a
toolset by installing a distribution; nothing here is edited.

@module reactor_mcp_server.__main__
"""

from __future__ import annotations

import argparse
import logging
import os

from reactor_mcp_server.app import create_mcp_app
from reactor_mcp_server.extension import load_extensions
from reactor_mcp_server.server import build_host

#: Entry-point names to load, to the exclusion of everything else installed.
#: What makes a tool list reproducible on a machine that happens to carry an
#: extra extension.
EXTENSIONS_ENV = "REACTOR_MCP_EXTENSIONS"


def parser() -> argparse.ArgumentParser:
    parsed = argparse.ArgumentParser(
        prog="reactor-mcp-server",
        description="Serve the installed MCP extensions over streamable HTTP.",
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
    parsed.add_argument("--log-level", default=os.environ.get("REACTOR_MCP_LOG", "info"))
    return parsed


def main(argv: list[str] | None = None) -> None:
    arguments = parser().parse_args(argv)
    logging.basicConfig(level=arguments.log_level.upper())
    names = arguments.extension or [
        part.strip()
        for part in (os.environ.get(EXTENSIONS_ENV) or "").split(",")
        if part.strip()
    ]
    host = build_host(load_extensions(names or None), name=arguments.name)
    app = create_mcp_app(host, path=arguments.path)

    import uvicorn  # noqa: PLC0415 - only the serving path needs it

    uvicorn.run(app, host=arguments.host, port=arguments.port, log_level=arguments.log_level)


if __name__ == "__main__":
    main()
