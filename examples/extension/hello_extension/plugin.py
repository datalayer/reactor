# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""The Python half of the hello extension."""

from __future__ import annotations

from reactor import PluginCompatibility, PluginManifest
from reactor.hooks import hookimpl

HELLO_MANIFEST = PluginManifest(
    name="hello",
    version="0.1.0",
    display_name="Hello",
    description="Serves the greeting the hello panel shows.",
    octicon="smiley",
    emoji="👋",
    # Declared, not enforced — the browser is somewhere this platform cannot
    # see. It is answered by `GET /plugins/frontend-requirements`.
    frontend_dependencies=["@hello/panel"],
    compatibility=PluginCompatibility(api_version="v1"),
)


class HelloPlugin:
    """A plugin with one thing to say, reachable through the platform."""

    @hookimpl
    def on_reactor_start(self, tenant_id: str | None = None) -> None:
        print(f"[HelloPlugin] started tenant={tenant_id}")

    def provide_routes(self) -> list[dict]:
        return [{"path": "/api/hello", "method": "GET", "plugin": "hello"}]

    def invoke_action(
        self,
        action: str,
        payload: dict | None = None,
        tenant_id: str | None = None,
    ) -> dict:
        if action != "greet":
            raise ValueError(f"Unsupported action '{action}' for hello plugin")
        name = (payload or {}).get("name", "world")
        return {"greeting": f"Hello, {name}!"}
