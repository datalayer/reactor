# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

from __future__ import annotations

import asyncio
import json
from dataclasses import asdict

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel

from .extensions import EXTENSION_ENTRY_POINT_GROUP
from .reactor import PluginPlatform

#: Content types for what a frontend extension is allowed to serve.
#:
#: An allowlist rather than a guess: this route hands files out of an installed
#: distribution, and the set of things a browser should execute from there is
#: small and knowable.
_CONTENT_TYPES = {
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".json": "application/json",
    ".css": "text/css",
    ".map": "application/json",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
}


class PluginTogglePayload(BaseModel):
    enabled: bool


class TenantTogglePayload(BaseModel):
    tenant_id: str
    enabled: bool


class PluginInvokePayload(BaseModel):
    action: str
    payload: dict = {}
    tenant_id: str | None = None


def create_reactor_app(reactor: PluginPlatform | None = None) -> FastAPI:
    runtime = reactor or PluginPlatform()
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

    @app.get("/extensions")
    def list_extensions() -> list[dict]:
        """Every extension and the plugins it delivered.

        The grouping a host needs to present a plugin list the way it was
        installed. Extensions have no lifecycle, so there is nothing to toggle
        here — the switches stay on `/plugins`.
        """
        return runtime.list_extensions()

    @app.post("/events/{event}")
    def fire_event(event: str) -> dict[str, list[str]]:
        """Fire an event; answer with what stood down and what woke.

        Deactivation runs first, so one event can retire the old thing and
        bring up the new. Firing an event nobody waits on is free and does
        nothing, so a caller can fire liberally rather than checking first.
        """
        return runtime.fire_event(event)

    @app.post("/plugins/{plugin_name}/deactivate")
    def deactivate_plugin(plugin_name: str) -> dict[str, list[str]]:
        """Stand a plugin down, dependants first.

        Not the same as toggling it off: a deactivated plugin keeps its place
        and comes back when one of its activation events fires. The switch is
        `/plugins/{name}/toggle`.
        """
        try:
            return {"deactivated": runtime.deactivate_plugin(plugin_name)}
        except KeyError as error:
            raise HTTPException(status_code=404, detail=str(error)) from error

    @app.get("/plugins/state")
    def plugin_state() -> dict:
        """A cheap snapshot: the revision, and each plugin's two flags.

        The poll half of the pair below. A browser that keeps the last
        ``revision`` it saw can ask this on a timer and do nothing until the
        number moves — which is why the stream is an optimisation rather than a
        different mechanism, and why a deployment that cannot hold a connection
        open is not missing a feature.
        """
        return {
            "revision": runtime.revision,
            "plugins": [
                {
                    "name": plugin["name"],
                    "enabled": plugin["enabled"],
                    "activated": plugin["activated"],
                }
                for plugin in runtime.list_plugins()
            ],
        }

    @app.get("/events/stream")
    async def event_stream(
        request: Request, poll_seconds: float = 0.5, max_seconds: float = 0.0
    ) -> StreamingResponse:
        """Server-sent events: one message whenever the platform changes.

        Implemented as a watched revision rather than a fan-out of callbacks,
        deliberately. A plugin platform is not a message bus, and the consumer
        only ever wants the current answer — so a browser that reconnects after
        a dropped connection is immediately correct, with no replay and no
        missed events to reason about.

        The first message is sent unconditionally, so a client is in step
        before anything happens.
        """

        async def events():
            last: int | None = None
            heartbeat = 0.0
            elapsed = 0.0
            while True:
                if await request.is_disconnected():
                    break
                # `max_seconds` closes the connection after that long; zero —
                # the default — means "until the client goes". Worth having
                # because `EventSource` reconnects on its own, so a proxy with
                # opinions about long-lived connections can be pre-empted here
                # rather than cutting one somewhere nobody can see.
                if max_seconds and elapsed >= max_seconds:
                    break
                current = runtime.revision
                if current != last:
                    last = current
                    heartbeat = 0.0
                    yield f"data: {json.dumps(plugin_state())}\n\n"
                elif heartbeat >= 15.0:
                    # A comment, not an event. Proxies close a connection that
                    # has been quiet, and a plugin platform can be quiet for a
                    # long time and still be working.
                    heartbeat = 0.0
                    yield ": keep-alive\n\n"
                await asyncio.sleep(poll_seconds)
                heartbeat += poll_seconds
                elapsed += poll_seconds

        return StreamingResponse(
            events(),
            media_type="text/event-stream",
            headers={
                "cache-control": "no-cache",
                # Nginx buffers by default, which turns a stream into one very
                # late response.
                "x-accel-buffering": "no",
            },
        )

    @app.get("/plugins/frontend-extensions")
    def frontend_extensions(refresh: bool = True) -> list[dict]:
        """Every installed extension's frontend half, rescanning first.

        The rescan is what makes ``pip install`` while the server runs work: a
        browser refresh hits this endpoint, the endpoint looks at what is
        installed *now*, and an extension that arrived a minute ago is in the
        answer. There is no restart and no watcher — the refresh is the reload.

        Pass ``refresh=false`` to answer from the registry alone, which is what
        a deployment that installs extensions only at boot should do.
        """
        if refresh:
            runtime.rescan_extensions(EXTENSION_ENTRY_POINT_GROUP)
        return runtime.frontend_extensions()

    @app.get("/reactor-extensions/{extension_name}/{asset_path:path}")
    def extension_asset(extension_name: str, asset_path: str) -> FileResponse:
        """Serve one file out of an installed extension's frontend directory.

        One route rather than a mount per extension, and that is the whole
        reason installing at runtime works: ``StaticFiles`` mounts are fixed
        when the application is built, so an extension discovered afterwards
        would have nowhere to be served from. Resolving the directory per
        request costs a dictionary lookup and buys the feature.
        """
        frontend = runtime.frontend_extension(extension_name)
        if frontend is None:
            raise HTTPException(status_code=404, detail=f"No extension {extension_name}")
        resolved = frontend.resolve(asset_path)
        if resolved is None:
            # Deliberately the same answer as a missing extension: a traversal
            # attempt should not be able to tell a file that is refused from
            # one that is not there.
            raise HTTPException(status_code=404, detail="Not found")
        media_type = _CONTENT_TYPES.get(resolved.suffix.lower())
        if media_type is None:
            raise HTTPException(status_code=404, detail="Not found")
        return FileResponse(resolved, media_type=media_type)

    @app.get("/plugins/frontend-requirements")
    def frontend_requirements(active: str = "") -> dict[str, dict[str, list[str]]]:
        """What enabled plugins ask of the frontend, and what is missing.

        `active` is a comma-separated list of the frontend plugin names the
        caller has loaded. The platform cannot see them itself, so the caller
        supplies them and the platform answers.
        """
        names = [name.strip() for name in active.split(",") if name.strip()]
        return runtime.frontend_requirements(names)

    @app.get("/contributions")
    def contributions(tenant_id: str | None = None) -> list[dict]:
        """Every contribution point that holds something, and what each holds.

        The other half of the graph a host draws: `/plugins` says who exists
        and what they depend on, this says who fills whose contribution points.
        """
        return runtime.describe_contributions(tenant_id)

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
