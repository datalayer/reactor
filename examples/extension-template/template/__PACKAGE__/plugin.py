# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""The Python half of the __NAME__ extension."""

from __future__ import annotations

from reactor import PluginManifest

MANIFEST = PluginManifest(
    name="__NAME__",
    version="0.1.0",
    display_name="__NAME__",
    description="Server side of the __NAME__ extension.",
)


class Plugin:
    """Whatever the server side of this capability is. Routes, for a start."""

    def provide_routes(self) -> list[dict]:
        return [{"path": "/__NAME__", "method": "GET", "summary": "Says hello."}]
