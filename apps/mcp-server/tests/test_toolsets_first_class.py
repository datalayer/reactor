# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""What a host does with toolsets beyond picking them from a URL.

A toolset's instructions reach only the sessions that have it; a client in a
session can ask which toolsets there are; a deployment can decide what a bare
URL gets, keep its own query keys from being read as names, and ask what a
request is about to get without building anything.

Launch the tests:
```
$ pytest tests/test_toolsets_first_class.py -v
```
"""

from __future__ import annotations

import asyncio
import json

from reactor import PluginManifest
from starlette.testclient import TestClient

from reactor_mcp_server import (
    LIST_SERVER_TOOLSETS,
    McpExtension,
    Toolset,
    build_host,
    create_mcp_app,
    on_toolset,
    parse_selection,
    tool,
)


class Notebooks(McpExtension):
    def manifest(self) -> PluginManifest:
        return PluginManifest(name="notebooks", version="1.0.0")

    def toolsets(self):
        return (
            Toolset(
                name="notebooks",
                title="Notebooks",
                description="Read and run notebooks",
                instructions="Read a notebook before running it.",
            ),
        )

    @tool()
    async def list_notebooks(self) -> list[str]:
        """Every notebook the caller can reach."""
        return ["Titanic"]


class Odoo(McpExtension):
    def manifest(self) -> PluginManifest:
        return PluginManifest(
            name="odoo", version="1.0.0", activation_events=[on_toolset("odoo")]
        )

    def toolsets(self):
        return (
            Toolset(
                name="odoo",
                description="Invoices",
                default=False,
                instructions="Never post an invoice without asking.",
            ),
        )

    @tool()
    async def list_invoices(self) -> list[str]:
        """Draft invoices."""
        return []


def a_host(**options):
    return build_host([Notebooks(), Odoo()], name="tests", **options)


class TestInstructions:
    def test_a_toolset_s_instructions_reach_the_sessions_that_have_it(self) -> None:
        host = a_host()
        server = host.build(parse_selection("odoo")).server
        assert "Never post an invoice" in (server.instructions or "")
        assert "## Notebooks" in (server.instructions or "")

    def test_and_only_those(self) -> None:
        server = a_host().build().server
        assert "Never post an invoice" not in (server.instructions or "")

    def test_the_host_s_own_come_first(self) -> None:
        host = build_host([Notebooks()], name="tests", instructions="Be brief.")
        assert (host.build().server.instructions or "").startswith("Be brief.")


class TestListToolsets:
    def test_off_unless_asked_for(self) -> None:
        assert LIST_SERVER_TOOLSETS not in a_host().build().tool_names

    def test_it_answers_what_toolsets_says(self) -> None:
        host = a_host(toolsets_tool=True)
        built = host.build()
        assert LIST_SERVER_TOOLSETS in built.tool_names
        answer = asyncio.run(built.server.call_tool(LIST_SERVER_TOOLSETS, {}))
        body = answer.structured_content or json.loads(answer.content[0].text)
        by_name = {item["name"]: item for item in body["toolsets"]}
        assert by_name["odoo"]["active"] is False
        assert by_name["notebooks"]["title"] == "Notebooks"
        assert body["active"] == ["notebooks"]
        assert "?name" in body["how_to_select"]


class TestTheDeploymentDecides:
    def test_what_a_bare_url_gets(self) -> None:
        app = create_mcp_app(a_host(), default_selection=parse_selection("only=odoo"))
        with TestClient(app) as client:
            assert client.get("/toolsets").json()["active"] == ["odoo"]

    def test_a_url_that_names_something_is_not_overridden(self) -> None:
        app = create_mcp_app(a_host(), default_selection=parse_selection("only=odoo"))
        with TestClient(app) as client:
            assert client.get("/toolsets?only=notebooks").json()["active"] == ["notebooks"]

    def test_its_own_query_keys_are_not_names(self) -> None:
        app = create_mcp_app(a_host(), ignore_query_keys=["scopes"])
        with TestClient(app) as client:
            answer = client.get("/toolsets?scopes=data:read&odoo").json()
        assert answer["unknown"] == []
        assert "odoo" in answer["active"]

    def test_without_it_they_are(self) -> None:
        with TestClient(create_mcp_app(a_host())) as client:
            assert client.get("/toolsets?scopes=data:read").json()["unknown"] == ["scopes"]


class TestActiveFor:
    def test_only_names_a_toolset_without_naming_it_in_the_flags(self) -> None:
        assert a_host().active_for(parse_selection("only=odoo")) == {"odoo"}

    def test_a_default_toolset_is_active_unnamed(self) -> None:
        assert a_host().active_for() == {"notebooks"}

    def test_without_takes_one_away(self) -> None:
        assert a_host().active_for(parse_selection("odoo&without=odoo")) == {"notebooks"}


class Narrowing(McpExtension):
    """Woken by `odoo`, it re-describes a tool of the default toolset."""

    def __init__(self) -> None:
        self.started = 0

    def manifest(self) -> PluginManifest:
        return PluginManifest(
            name="narrowing", version="1.0.0", activation_events=[on_toolset("odoo")]
        )

    def toolsets(self):
        return (Toolset(name="odoo", default=False),)

    def tool_extensions(self):
        from reactor_mcp_server import ToolExtension

        return (("list_notebooks", ToolExtension(description="Narrowed.")),)

    def on_start(self) -> None:
        self.started += 1


class TestWakingAnExtension:
    def test_it_is_started_when_woken(self) -> None:
        narrowing = Narrowing()
        host = build_host([Notebooks(), Odoo(), narrowing], name="tests")
        assert narrowing.started == 0
        host.build(parse_selection("odoo"))
        assert narrowing.started == 1

    def test_no_server_built_before_it_is_served_after(self) -> None:
        host = build_host([Notebooks(), Odoo(), Narrowing()], name="tests")
        before = host.build()
        revision = host.revision
        host.build(parse_selection("odoo"))
        after = host.build()
        assert host.revision > revision
        assert after.server is not before.server
        [spec] = [spec for spec in after.tools if spec.name == "list_notebooks"]
        assert spec.documentation == "Narrowed."

    def test_asking_again_keeps_the_cache(self) -> None:
        host = a_host()
        host.build(parse_selection("odoo"))
        revision = host.revision
        host.build(parse_selection("odoo"))
        assert host.revision == revision


class TestTheToolNeverShadowsAnExtension:
    def test_an_extension_s_tool_of_that_name_is_served(self) -> None:
        class Own(McpExtension):
            def manifest(self) -> PluginManifest:
                return PluginManifest(name="own", version="1.0.0")

            @tool(name=LIST_SERVER_TOOLSETS)
            async def mine(self) -> str:
                """The extension's own."""
                return "mine"

        host = build_host([Own()], name="tests", toolsets_tool=True)
        [spec] = [s for s in host.build().tools if s.name == LIST_SERVER_TOOLSETS]
        assert spec.documentation == "The extension's own."
