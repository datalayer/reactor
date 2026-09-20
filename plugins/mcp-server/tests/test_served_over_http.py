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
from reactor import PluginManifest

from reactor_mcp_server import (
    McpExtension,
    Toolset,
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
