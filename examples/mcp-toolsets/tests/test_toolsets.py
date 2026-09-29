# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""The two example toolsets, as a client sees them.

`math` is on for everybody; `geo` only for a client that asks, and its
extension is not woken until one does. Over HTTP the URL decides, over stdio
the command line does.

Launch the tests:
```
$ pytest examples/mcp-toolsets/tests -v
```
"""

from __future__ import annotations

import asyncio
import importlib.metadata
import socket
import sys
import threading
from contextlib import asynccontextmanager, closing

import pytest
import uvicorn
from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client
from mcp.client.streamable_http import streamable_http_client
from reactor_mcp_server import (
    LIST_SERVER_TOOLSETS,
    build_host,
    create_mcp_app,
    parse_selection,
)

from reactor_toolsets_example import GeoExtension, MathExtension

MATH = {"add", "multiply"}
GEO = {"get_capital_of_country", "get_country_of_capital"}


def a_host(**options):
    return build_host([MathExtension(), GeoExtension()], name="example", **options)


class TestOnAHost:
    def test_math_is_on_by_default(self) -> None:
        assert set(a_host().build().tool_names) == MATH

    def test_geo_is_served_to_a_client_that_asks(self) -> None:
        assert set(a_host().build(parse_selection("geo")).tool_names) == MATH | GEO

    def test_only_geo(self) -> None:
        assert set(a_host().build(parse_selection("only=geo")).tool_names) == GEO

    def test_geo_is_not_woken_until_asked_for(self) -> None:
        host = a_host()

        def activated() -> set[str]:
            return {item["name"] for item in host.platform.list_plugins() if item["activated"]}

        host.build()
        assert "geo" not in activated()
        host.build(parse_selection("geo"))
        assert "geo" in activated()

    def test_math_instructions_ride_with_math(self) -> None:
        assert "math tools" in (a_host().build().server.instructions or "")
        only_geo = a_host().build(parse_selection("only=geo")).server
        assert "math tools" not in (only_geo.instructions or "")


class TestTheTools:
    def test_add_and_multiply(self) -> None:
        math = MathExtension()
        assert asyncio.run(math.add(2, 3)) == 5
        assert asyncio.run(math.multiply(4, 2.5)) == 10

    def test_capitals_both_ways(self) -> None:
        geo = GeoExtension()
        assert asyncio.run(geo.get_capital_of_country("France")) == "Paris"
        assert asyncio.run(geo.get_country_of_capital("tokyo")) == "Japan"

    def test_an_unknown_country_is_an_error_the_model_can_read(self) -> None:
        with pytest.raises(ValueError, match="Atlantis"):
            asyncio.run(GeoExtension().get_capital_of_country("Atlantis"))


def a_free_port() -> int:
    with closing(socket.socket()) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


@pytest.fixture(scope="module")
def served() -> str:
    app = create_mcp_app(a_host(toolsets_tool=True), path="/mcp")
    port = a_free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
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
async def over_http(url: str):
    async with streamable_http_client(url) as (read, write, *_):
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield session


async def tool_names(session: ClientSession) -> set[str]:
    return {item.name for item in (await session.list_tools()).tools}


class TestOverHttp:
    async def test_the_url_picks_the_toolsets(self, served) -> None:
        async with over_http(f"{served}/mcp") as session:
            assert await tool_names(session) == MATH | {LIST_SERVER_TOOLSETS}
        async with over_http(f"{served}/mcp?geo") as session:
            assert await tool_names(session) == MATH | GEO | {LIST_SERVER_TOOLSETS}

    async def test_a_geo_call(self, served) -> None:
        async with over_http(f"{served}/mcp?only=geo") as session:
            answer = await session.call_tool("get_capital_of_country", {"country": "Kenya"})
        assert "Nairobi" in answer.content[0].text

    async def test_a_session_can_find_out_about_geo(self, served) -> None:
        async with over_http(f"{served}/mcp") as session:
            answer = await session.call_tool(LIST_SERVER_TOOLSETS, {})
        assert '"geo"' in answer.content[0].text


def installed() -> bool:
    points = importlib.metadata.entry_points(group="reactor.mcp.extensions")
    return {"math", "geo"} <= {point.name for point in points}


@pytest.mark.skipif(not installed(), reason="pip install -e examples/mcp-toolsets first")
class TestOverStdio:
    async def test_the_command_line_picks_the_toolsets(self) -> None:
        params = StdioServerParameters(
            command=sys.executable,
            args=[
                "-m", "reactor_mcp_server",
                "--transport", "stdio",
                "--extension", "math",
                "--extension", "geo",
                "--toolsets", "only=geo",
            ],
        )
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                assert await tool_names(session) == GEO | {LIST_SERVER_TOOLSETS}
                answer = await session.call_tool("get_capital_of_country", {"country": "Italy"})
        assert "Rome" in answer.content[0].text
