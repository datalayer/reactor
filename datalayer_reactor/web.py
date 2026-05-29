from __future__ import annotations

from dataclasses import asdict

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .platform import PluginPlatform


class PluginTogglePayload(BaseModel):
    enabled: bool


class TenantTogglePayload(BaseModel):
    tenant_id: str
    enabled: bool


class PluginInvokePayload(BaseModel):
    action: str
    payload: dict = {}
    tenant_id: str | None = None


def create_platform_app(platform: PluginPlatform | None = None) -> FastAPI:
    runtime = platform or PluginPlatform()
    app = FastAPI(title="Datalayer Reactor", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/plugins")
    def list_plugins() -> list[dict]:
        return runtime.list_plugins()

    @app.post("/plugins/{plugin_name}/toggle")
    def toggle_plugin(plugin_name: str, payload: PluginTogglePayload) -> dict[str, str]:
        try:
            if payload.enabled:
                runtime.enable_plugin(plugin_name)
            else:
                runtime.disable_plugin(plugin_name)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {"plugin": plugin_name, "enabled": str(payload.enabled).lower()}

    @app.post("/tenants/plugins/{plugin_name}/toggle")
    def toggle_tenant_plugin(plugin_name: str, payload: TenantTogglePayload) -> dict[str, str]:
        try:
            if payload.enabled:
                runtime.enable_plugin_for_tenant(plugin_name, payload.tenant_id)
            else:
                runtime.disable_plugin_for_tenant(plugin_name, payload.tenant_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc
        return {
            "plugin": plugin_name,
            "tenant": payload.tenant_id,
            "enabled": str(payload.enabled).lower(),
        }

    @app.get("/tenants/{tenant_id}/features")
    def tenant_features(tenant_id: str) -> dict[str, bool]:
        return runtime.feature_flags(tenant_id)

    @app.get("/tenants/{tenant_id}/routes")
    def tenant_routes(tenant_id: str) -> list[dict]:
        return runtime.collect_routes(tenant_id=tenant_id)

    @app.get("/marketplace")
    def marketplace() -> list[dict]:
        return [asdict(entry) for entry in runtime.marketplace.list_plugins()]

    @app.post("/plugins/{plugin_name}/invoke")
    def invoke_plugin(plugin_name: str, request: PluginInvokePayload) -> dict:
        try:
            return runtime.invoke_plugin_action(
                plugin_name=plugin_name,
                action=request.action,
                payload=request.payload,
                tenant_id=request.tenant_id,
            )
        except (KeyError, ValueError) as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    return app
