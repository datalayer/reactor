# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Serving the host over HTTP, with the URL deciding what is served.

One endpoint, many servers. A client connects to ``/mcp`` and gets the default
toolsets; a client that connects to ``/mcp?benchmarks`` gets those as well. The
selection is read per connection, the matching server is built once and kept,
and two clients asking for the same toolsets share it.

Why per connection rather than per call: MCP is a session. A client lists the
tools once at the start and works from that list, so a server that changed its
tools mid-session would have clients calling tools that are no longer there and
never seeing the ones that are. The URL is the one place a client states what
it wants *before* the session exists.

@module reactor_mcp_server.app
"""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Awaitable, Callable, MutableMapping, Optional

import anyio
from anyio.abc import TaskStatus

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

from reactor_mcp_server.server import McpHost
from reactor_mcp_server.toolsets import (
    activation_key,
    selection_from_scope,
)

logger = logging.getLogger(__name__)

Scope = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[MutableMapping[str, Any]]]
Send = Callable[[MutableMapping[str, Any]], Awaitable[None]]


class ToolsetRouter:
    """The ASGI application in front of the built servers.

    It owns nothing but the routing decision: read the query, ask the host for
    the server that selection means, and hand the connection to it. The SDK's
    own streamable-HTTP application does the protocol.

    The one piece of bookkeeping it does keep is each application's
    **lifespan**. The SDK's app starts its session manager there, and a
    sub-application's lifespan is not run by the application that routes to
    it — so an app served without one answers every request with "Task group
    is not initialized", which reads like a bug in the protocol rather than a
    missing startup.

    Each lifespan runs in a **task of its own**, started the first time that
    set of toolsets is asked for and kept until shutdown. Not opened inline
    in the request that first asked for it: a lifespan is an async context
    holding cancel scopes, and a scope entered in one task and left in
    another is an error anyio raises at the end — "Attempted to exit cancel
    scope in a different task than it was entered in", on shutdown, after the
    work is done and where nobody is looking for it.
    """

    def __init__(
        self,
        host: McpHost,
        *,
        path: str = "/mcp",
        app_options: Optional[dict[str, Any]] = None,
    ) -> None:
        self._host = host
        self._path = path
        # What the SDK's application is built with, beside the path: whether
        # sessions are issued, how large a request may be, what the transport
        # allows. They are the deployment's answers rather than this router's,
        # and every selection is served with the same ones — a client that
        # asked for another toolset did not ask for another transport.
        self._app_options = dict(app_options or {})
        self._apps: dict[str, Any] = {}
        self._tasks: Any = None
        self._closing: anyio.Event | None = None
        self._lock = asyncio.Lock()

    @property
    def host(self) -> McpHost:
        return self._host

    async def start(self) -> None:
        """Open the scope the applications' lifespans live in.

        Entered and left in the same task — this one, the application's own
        lifespan — while each served application's lifespan runs in a child
        of it.
        """
        if self._tasks is None:
            self._closing = anyio.Event()
            self._tasks = anyio.create_task_group()
            await self._tasks.__aenter__()

    async def stop(self) -> None:
        """Close every lifespan this router started, and wait for it."""
        tasks, self._tasks = self._tasks, None
        closing, self._closing = self._closing, None
        self._apps.clear()
        if closing is not None:
            closing.set()
        if tasks is not None:
            await tasks.__aexit__(None, None, None)

    async def _serve(
        self, app: Any, *, task_status: "TaskStatus[None]"
    ) -> None:
        """Run one application's lifespan until this router is stopped.

        The task reports itself started once the lifespan is open, so the
        request that asked for this application waits for its session manager
        rather than racing it — and a lifespan that fails to start fails
        *there*, in the request, instead of leaving it waiting.
        """
        assert self._closing is not None
        async with app.router.lifespan_context(app):
            task_status.started()
            await self._closing.wait()

    async def app_for(self, key: str, built: Any) -> Any:
        """The SDK application serving this set of toolsets, started once.

        Keyed on the toolsets rather than on the query string: `?a&b` and
        `?b&a` are one server, and so are `?a` and `?toolsets=a`.

        Built for the path this router serves, and reached with the path the
        client sent. Mounting it instead would strip the prefix and redirect
        `/mcp` to `/mcp/` — which a client posting JSON-RPC does not follow,
        so the session never starts and the endpoint looks broken rather than
        misrouted.
        """
        existing = self._apps.get(key)
        if existing is not None:
            return existing
        async with self._lock:
            existing = self._apps.get(key)
            if existing is not None:
                return existing
            await self.start()
            app = built.server.streamable_http_app(
                streamable_http_path=self._path, **self._app_options
            )
            assert self._tasks is not None
            await self._tasks.start(self._serve, app)
            self._apps[key] = app
            return app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":  # pragma: no cover - websockets are not served
            raise RuntimeError(f"{type(self).__name__} serves HTTP only")
        selection = selection_from_scope(scope)
        built = self._host.build(selection)
        if built.unknown:
            # Named but not declared. Served anyway — a stale name in an
            # agent's configuration should not take the connection down — and
            # logged, because it is also how a client finds out it is asking
            # for something that no longer exists.
            logger.warning(
                "MCP client asked for unknown toolsets: %s",
                ", ".join(sorted(built.unknown)),
            )
        key = activation_key(built.toolsets)
        app = await self.app_for(key, built)
        await app(scope, receive, send)


def create_mcp_app(
    host: McpHost,
    *,
    path: str = "/mcp",
    healthz: Optional[str] = "/healthz",
    toolsets_route: Optional[str] = "/toolsets",
    app_options: Optional[dict[str, Any]] = None,
) -> Starlette:
    """An application serving `host` at `path`.

    Two routes come with it, both answering questions a hosted endpoint is
    asked constantly:

    * ``/healthz`` — whether the process is up, without opening a session;
    * ``/toolsets`` — what this deployment offers and what a URL would
      activate, so a client can be *told* which name to put in its URL rather
      than being sent to read the deployment's source.
    """
    router = ToolsetRouter(host, path=path, app_options=app_options)

    async def toolsets(request: Request) -> JSONResponse:
        selection = selection_from_scope(request.scope)
        built = host.build(selection)
        declared = host.declared_toolsets()
        return JSONResponse(
            {
                "toolsets": [
                    {
                        "name": toolset.name,
                        "description": toolset.description,
                        "default": toolset.default,
                        "always": toolset.always,
                        "active": toolset.name in built.toolsets,
                    }
                    for toolset in sorted(declared, key=lambda item: item.name)
                ],
                "active": sorted(built.toolsets),
                "tools": sorted(built.tool_names),
                "unknown": sorted(built.unknown),
            }
        )

    async def health(request: Request) -> JSONResponse:
        return JSONResponse({"success": True, "service": host.name})

    routes = []
    if healthz:
        routes.append(Route(healthz, health, methods=["GET"]))
    if toolsets_route:
        routes.append(Route(toolsets_route, toolsets, methods=["GET"]))
    # Last, and mounted at the root so the path reaches the SDK's application
    # exactly as the client sent it. The two routes above are matched first.
    routes.append(Mount("", app=router))

    @asynccontextmanager
    async def lifespan(_: Starlette) -> AsyncIterator[None]:
        await router.start()
        try:
            yield
        finally:
            await router.stop()

    app = Starlette(routes=routes, lifespan=lifespan)
    app.state.mcp_host = host
    return app
