# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""A plugin declares what an agent may do with it; the host lists it."""

from __future__ import annotations

from fastapi.testclient import TestClient

from reactor import PluginManifest, PluginPlatform
from reactor.web import create_reactor_app


class Decks:
    def provide_agent_tools(self) -> list[dict]:
        return [
            {
                "id": "decks",
                "name": "Decks",
                "commands": [
                    {"name": "decks_next_slide", "command": "decks.nextSlide", "description": "Next"},
                    {
                        "name": "decks_open",
                        "command": "decks.open",
                        "description": "Open",
                        "parameters": {"type": "object", "properties": {"id": {"type": "string"}}},
                    },
                ],
            }
        ]


class Quiet:
    pass


def test_bundles_are_collected_with_their_defaults_filled() -> None:
    platform = PluginPlatform()
    platform.register_plugin(PluginManifest(name="decks", version="1.0.0"), Decks())
    platform.register_plugin(PluginManifest(name="quiet", version="1.0.0"), Quiet())
    [bundle] = platform.collect_agent_tools()
    assert bundle["plugin"] == "decks"
    assert bundle["toolset"] == ["decks_next_slide", "decks_open"]
    assert [c["command"] for c in bundle["commands"]] == ["decks.nextSlide", "decks.open"]


def test_a_disabled_plugin_offers_nothing() -> None:
    platform = PluginPlatform()
    platform.register_plugin(PluginManifest(name="decks", version="1.0.0"), Decks())
    platform.disable_plugin("decks")
    assert platform.collect_agent_tools() == []


def test_the_api_lists_them() -> None:
    platform = PluginPlatform()
    platform.register_plugin(PluginManifest(name="decks", version="1.0.0"), Decks())
    client = TestClient(create_reactor_app(platform))
    answer = client.get("/plugins/agent-tools")
    assert answer.status_code == 200
    assert [b["id"] for b in answer.json()] == ["decks"]
