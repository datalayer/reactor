from __future__ import annotations

from .hooks import hookimpl


class GreetingPlugin:
    @hookimpl
    def on_platform_start(self, tenant_id: str | None = None) -> None:
        print(f"[GreetingPlugin] started tenant={tenant_id}")

    @hookimpl
    def on_platform_stop(self, tenant_id: str | None = None) -> None:
        print(f"[GreetingPlugin] stopped tenant={tenant_id}")

    def provide_routes(self) -> list[dict]:
        return [{"path": "/greet", "method": "GET", "plugin": "greeting"}]

    def feature_flags(self, tenant_id: str) -> dict[str, bool]:
        return {"greeting.widget": True}

    def invoke_action(
        self,
        action: str,
        payload: dict | None = None,
        tenant_id: str | None = None,
    ) -> dict:
        data = payload or {}
        if action != "greet":
            raise ValueError(f"Unsupported action '{action}' for greeting-plugin")
        username = data.get("name", "Developer")
        return {
            "message": f"Hello {username}, greeting-plugin executed successfully.",
            "tenant": tenant_id or "default",
        }


class StatusPlugin:
    @hookimpl
    def on_platform_start(self, tenant_id: str | None = None) -> None:
        print(f"[StatusPlugin] started tenant={tenant_id}")

    @hookimpl
    def on_platform_stop(self, tenant_id: str | None = None) -> None:
        print(f"[StatusPlugin] stopped tenant={tenant_id}")

    def provide_routes(self) -> list[dict]:
        return [{"path": "/status", "method": "GET", "plugin": "status"}]

    def feature_flags(self, tenant_id: str) -> dict[str, bool]:
        return {"status.banner": tenant_id != "free-tier"}

    def invoke_action(
        self,
        action: str,
        payload: dict | None = None,
        tenant_id: str | None = None,
    ) -> dict:
        data = payload or {}
        if action != "status":
            raise ValueError(f"Unsupported action '{action}' for status-plugin")
        environment = data.get("environment", "local")
        return {
            "state": "ready",
            "environment": environment,
            "plugin": "status-plugin",
            "tenant": tenant_id or "default",
        }
