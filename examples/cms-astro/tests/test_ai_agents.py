# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT / "ai-agents"))

from cms_astro_ai_agents import (  # noqa: E402
    AI_AGENTS_MANIFEST,
    CMS_AI_AGENT_TOOLS,
    extension,
)


def test_ai_agents_is_an_independent_python_packaged_extension() -> None:
    value = extension()
    assert value.manifest.name == "cms-astro-ai-agents"
    assert value.frontend is not None
    assert value.frontend.entry == "index.js"
    assert AI_AGENTS_MANIFEST.name == "cms-astro.ai-agents"
    assert AI_AGENTS_MANIFEST.frontend_dependencies == ["@cms-astro/ai-agents"]


def test_ai_agents_owns_the_complete_tool_contract() -> None:
    commands = CMS_AI_AGENT_TOOLS["commands"]
    assert CMS_AI_AGENT_TOOLS["plugin"] == "@cms-astro/ai-agents"
    assert CMS_AI_AGENT_TOOLS["toolset"] == [item["name"] for item in commands]
    assert len(commands) == 11
    assert commands[1]["name"] == "cms_crawl_feed"
    assert commands[4]["name"] == "cms_list_site_pages"
    assert commands[5]["name"] == "cms_read_site_page"
    assert commands[6]["name"] == "cms_get_current_site_page"
    assert commands[7]["name"] == "cms_update_site_page"
    assert commands[-3]["name"] == "cms_publish_site_page"
    assert commands[-2]["name"] == "cms_show_site_page"
    assert commands[-1]["name"] == "cms_refresh_site_view"
    assert all(item["description"] and item["parameters"] for item in commands)
