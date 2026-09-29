# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Serve the two example toolsets from code, without installing anything.

    python serve.py            # http://localhost:4040/mcp

The same host `reactor-mcp-server` builds from the installed entry points,
built here from the two classes directly.
"""

from __future__ import annotations

import sys
from pathlib import Path

# Runs from a checkout: the package sits beside this file.
sys.path.insert(0, str(Path(__file__).parent))

import uvicorn  # noqa: E402
from reactor_mcp_server import build_host, create_mcp_app  # noqa: E402

from reactor_toolsets_example import GeoExtension, MathExtension  # noqa: E402

host = build_host(
    [MathExtension(), GeoExtension()],
    name="toolsets-example",
    toolsets_tool=True,
)
app = create_mcp_app(host, path="/mcp")

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=4040)
