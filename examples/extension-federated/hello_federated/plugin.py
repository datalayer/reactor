# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""The Python half: a plugin the frontend requires to be present."""

from __future__ import annotations

from reactor import PluginManifest

HELLO_FEDERATED_MANIFEST = PluginManifest(
    name="hello-federated",
    version="0.1.0",
    display_name="Hello (federated)",
    description="The server side of a container-delivered extension.",
)


class HelloFederatedPlugin:
    """Nothing to do but exist: the frontend lists it as required."""

    def provide_routes(self) -> list[dict]:
        return [{"path": "/hello-federated", "method": "GET", "summary": "Greets, federatedly."}]
