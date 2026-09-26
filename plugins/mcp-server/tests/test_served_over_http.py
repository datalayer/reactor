# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""A real MCP client, over HTTP, against the served host.

Everything else here tests the parts. This tests the thing: a client connects
to `/mcp`, lists tools and calls one — and the same client connecting to
`/mcp?benchmarks` gets a different list from the same process.

Launch the tests:
```
$ pytest tests/test_served_over_http.py -v
```
"""

from __future__ import annotations

import asyncio
import socket
import threading
from contextlib import asynccontextmanager, closing

import pytest
import uvicorn
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.server.mcpserver import MCPServer
from reactor import PluginManifest

from reactor_mcp_server import (
    McpExtension,
    Toolset,
    ToolsetRouter,
    build_host,
    create_mcp_app,
    on_toolset,
    tool,
)


class Notebooks(McpExtension):
    def manifest(self) -> PluginManifest:
        return PluginManifest(name="notebooks", version="1.0.0")

    def toolsets(self):
        return (Toolset(name="notebooks", description="Read and run notebooks"),)

    @tool(title="List Notebooks")
    async def list_notebooks(self) -> list[str]:
        """Every notebook the caller can reach."""
        return ["Titanic", "Pyramid"]


class Benchmarks(McpExtension):
    def manifest(self) -> PluginManifest:
        return PluginManifest(
            name="benchmarks",
            version="1.0.0",
            activation_events=[on_toolset("benchmarks")],
        )

    def toolsets(self):
        return (Toolset(name="benchmarks", default=False, description="Evaluations"),)

    @tool()
    async def run_benchmark(self, name: str) -> str:
        """Run one benchmark by name."""
        return f"ran {name}"


def a_free_port() -> int:
    with closing(socket.socket()) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


@pytest.fixture(scope="module")
def served() -> str:
    """The app, on a port of its own, for the length of this module."""
    host = build_host([Notebooks(), Benchmarks()], name="tests")
    app = create_mcp_app(host, path="/mcp")
    port = a_free_port()
    config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error")
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(200):
        if server.started:
            break
        threading.Event().wait(0.05)
    assert server.started, "the test server did not start"
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=10)


@asynccontextmanager
async def connected(url: str):
    async with streamable_http_client(url) as (read, write, *_):
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield session


class TestAClientConnecting:
    async def test_it_gets_the_default_toolsets(self, served) -> None:
        async with connected(f"{served}/mcp") as session:
            names = {item.name for item in (await session.list_tools()).tools}

        assert names == {"list_notebooks"}

    async def test_naming_a_toolset_brings_its_tools(self, served) -> None:
        async with connected(f"{served}/mcp?benchmarks") as session:
            names = {item.name for item in (await session.list_tools()).tools}

        assert names == {"list_notebooks", "run_benchmark"}

    async def test_the_tool_it_lists_is_the_tool_it_can_call(self, served) -> None:
        async with connected(f"{served}/mcp?benchmarks") as session:
            answer = await session.call_tool("run_benchmark", {"name": "gsm8k"})

        assert "ran gsm8k" in str(answer.content or answer.structured_content)

    async def test_a_tool_of_a_toolset_it_did_not_ask_for_is_not_callable(
        self, served
    ) -> None:
        """Not merely hidden from the list: a client that guessed the name
        must not reach a toolset it did not activate."""
        async with connected(f"{served}/mcp") as session:
            answer = await session.call_tool("run_benchmark", {"name": "gsm8k"})

        assert answer.is_error

    async def test_the_title_and_description_reach_the_client(self, served) -> None:
        async with connected(f"{served}/mcp") as session:
            [item] = (await session.list_tools()).tools

        assert item.title == "List Notebooks"
        assert item.description.startswith("Every notebook")


class TestWhatTheEndpointSaysAboutItself:
    async def test_healthz_answers_without_a_session(self, served) -> None:
        import httpx  # noqa: PLC0415

        async with httpx.AsyncClient() as client:
            answer = await client.get(f"{served}/healthz")

        assert answer.status_code == 200
        assert answer.json()["success"] is True

    async def test_toolsets_says_what_there_is_and_what_is_on(self, served) -> None:
        """So a client can be told which name to put in its URL rather than
        being sent to read the deployment's source."""
        import httpx  # noqa: PLC0415

        async with httpx.AsyncClient() as client:
            plain = (await client.get(f"{served}/toolsets")).json()
            asked = (await client.get(f"{served}/toolsets?benchmarks")).json()

        assert {item["name"] for item in plain["toolsets"]} == {"notebooks", "benchmarks"}
        assert plain["active"] == ["notebooks"]
        assert asked["active"] == ["benchmarks", "notebooks"]
        assert "run_benchmark" in asked["tools"]

    async def test_an_unknown_name_is_reported_not_refused(self, served) -> None:
        import httpx  # noqa: PLC0415

        async with httpx.AsyncClient() as client:
            answer = (await client.get(f"{served}/toolsets?nosuch")).json()

        assert answer["unknown"] == ["nosuch"]
        assert answer["active"] == ["notebooks"]


class SaysHowItWasBuilt(MCPServer):
    """A server subclass, so a test can tell it from the default one.

    What a real deployment does here is heavier — CORS, an authentication
    middleware, the token verifier the operator configured — and the property
    that matters is the same: the selection is served *by this class*, not by
    something wrapped around a bare `MCPServer`.
    """

    built: list[str] = []

    def __init__(self, *args, **keywords) -> None:
        super().__init__(*args, **keywords)
        SaysHowItWasBuilt.built.append(self.name)

    def streamable_http_app(self, **keywords):
        SaysHowItWasBuilt.seen = dict(keywords)
        return super().streamable_http_app(**keywords)


class TestTheLifespansAreClosedCleanly:
    """A served application's lifespan is opened by the request that first
    asks for its toolsets, and closed on shutdown — two different tasks.

    anyio raises at the end of a cancel scope left in a task other than the
    one that entered it, which on a worker reads as "Application shutdown
    failed" after the work is done, where nobody is looking for it. So each
    lifespan gets a task of its own.
    """

    async def test_stopping_after_a_request_opened_one_does_not_raise(self) -> None:
        import anyio

        host = build_host([Notebooks()], name="tests")
        router = ToolsetRouter(host, path="/mcp")
        await router.start()

        async def asks_for_it() -> None:
            await router.app_for("notebooks", host.build())

        async with anyio.create_task_group() as tasks:
            tasks.start_soon(asks_for_it)
        await router.stop()

    async def test_and_the_application_it_opened_is_the_one_it_kept(self) -> None:
        host = build_host([Notebooks()], name="tests")
        router = ToolsetRouter(host, path="/mcp")
        built = host.build()
        first = await router.app_for("notebooks", built)
        try:
            assert await router.app_for("notebooks", built) is first
        finally:
            await router.stop()


class TestTheDeploymentDecidesHowAServerIsMade:
    """A host serves what the deployment built, not what the foundation would.

    The gateway's worker is the case: its server carries CORS, an identity
    middleware and a token verifier, and a client reaching a toolset through
    a bare `MCPServer` would reach it unauthenticated.
    """

    def test_the_factory_makes_the_server(self) -> None:
        SaysHowItWasBuilt.built.clear()
        host = build_host(
            [Notebooks()],
            name="tests",
            server_factory=lambda name, instructions: SaysHowItWasBuilt(
                name=name, instructions=instructions
            ),
        )
        built = host.build()
        assert isinstance(built.server, SaysHowItWasBuilt)
        assert SaysHowItWasBuilt.built == ["tests"]

    def test_the_tools_are_on_it(self) -> None:
        host = build_host(
            [Notebooks()],
            name="tests",
            server_factory=lambda name, instructions: SaysHowItWasBuilt(
                name=name, instructions=instructions
            ),
        )
        built = host.build()
        assert "list_notebooks" in built.tool_names

    async def test_the_transport_options_reach_the_app(self) -> None:
        """What the deployment says about sessions and limits, per selection.

        The SDK takes them where the app is built, which the router does —
        so without this a deployment that needs sessions gets the SDK's
        default instead, and a client waiting for an `Mcp-Session-Id` is
        handed nothing.
        """
        host = build_host(
            [Notebooks()],
            name="tests",
            server_factory=lambda name, instructions: SaysHowItWasBuilt(
                name=name, instructions=instructions
            ),
        )
        router = ToolsetRouter(host, path="/mcp", app_options={"stateless_http": False})
        await router.app_for("notebooks", host.build())
        try:
            assert SaysHowItWasBuilt.seen["stateless_http"] is False
            assert SaysHowItWasBuilt.seen["streamable_http_path"] == "/mcp"
        finally:
            await router.stop()
