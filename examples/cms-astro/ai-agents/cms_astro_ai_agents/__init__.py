# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Optional AI authoring extension discovered independently from CMS Core."""

from reactor import (
    ExtensionManifest,
    FrontendExtension,
    FrontendPlugin,
    PluginCompatibility,
    PluginManifest,
    ReactorExtension,
    find_extension_frontend,
)

CRAWL_PARAMETERS = {
    "type": "object",
    "properties": {
        "url": {"type": "string"},
        "limit": {"type": "integer", "minimum": 1, "maximum": 50},
    },
    "required": ["url"],
}

CMS_AI_AGENT_TOOLS = {
    "id": "cms-astro-ai-agents",
    "version": "0.1.0",
    "name": "Astro CMS AI Agents",
    "description": "Import public blogs and create or update content in the authenticated site.",
    "plugin": "@cms-astro/ai-agents",
    "toolset": [
        "cms_crawl_blog",
        "cms_crawl_wordpress",
        "cms_create_site_page",
        "cms_update_site_page",
        "cms_publish_site_page",
        "cms_show_site_page",
    ],
    "commands": [
        {
            "name": "cms_crawl_blog",
            "command": "cmsAstroAi.crawlBlog",
            "description": "Crawl pages linked from a public blog index.",
            "parameters": CRAWL_PARAMETERS,
        },
        {
            "name": "cms_crawl_wordpress",
            "command": "cmsAstroAi.crawlWordpress",
            "description": "Discover and read posts from a public WordPress REST API.",
            "parameters": CRAWL_PARAMETERS,
        },
        {
            "name": "cms_create_site_page",
            "command": "cmsAstroAi.createSitePage",
            "description": "Create a draft or published post or page in the current site.",
            "parameters": {
                "type": "object",
                "properties": {
                    "collection": {"type": "string", "enum": ["posts", "pages"]},
                    "title": {"type": "string"},
                    "slug": {"type": "string"},
                    "excerpt": {"type": "string"},
                    "body": {"type": "string"},
                    "source_url": {"type": "string"},
                    "publish": {"type": "boolean"},
                },
                "required": ["collection", "title", "body"],
            },
        },
        {
            "name": "cms_update_site_page",
            "command": "cmsAstroAi.updateSitePage",
            "description": "Update an explicitly identified entry in the current site.",
            "parameters": {
                "type": "object",
                "properties": {
                    "entry_id": {"type": "string"},
                    "existing_slug": {"type": "string"},
                    "collection": {"type": "string", "enum": ["posts", "pages"]},
                    "title": {"type": "string"},
                    "slug": {"type": "string"},
                    "excerpt": {"type": "string"},
                    "body": {"type": "string"},
                    "publish": {"type": "boolean"},
                },
                "required": ["collection"],
                "anyOf": [
                    {"required": ["entry_id"]},
                    {"required": ["existing_slug"]},
                ],
            },
        },
        {
            "name": "cms_publish_site_page",
            "command": "cmsAstroAi.publishSitePage",
            "description": "Publish an existing post or page identified by its entry ID or exact slug.",
            "parameters": {
                "type": "object",
                "properties": {
                    "entry_id": {"type": "string"},
                    "existing_slug": {"type": "string"},
                    "collection": {"type": "string", "enum": ["posts", "pages"]},
                },
                "required": ["collection"],
                "anyOf": [
                    {"required": ["entry_id"]},
                    {"required": ["existing_slug"]},
                ],
            },
        },
        {
            "name": "cms_show_site_page",
            "command": "cmsAstroAi.showSitePage",
            "description": "Open a published post or page in its rendered Astro website view.",
            "parameters": {
                "type": "object",
                "properties": {
                    "slug": {"type": "string"},
                    "collection": {"type": "string", "enum": ["posts", "pages"]},
                },
                "required": ["slug", "collection"],
            },
        },
    ],
}

AI_AGENTS_MANIFEST = PluginManifest(
    name="cms-astro.ai-agents",
    version="0.1.0",
    display_name="CMS AI Agents",
    description="Authenticated AI-assisted blog import and content authoring.",
    emoji="✍️",
    frontend_dependencies=["@cms-astro/ai-agents"],
    compatibility=PluginCompatibility(api_version="v1"),
)


class AiAgentsPlugin:
    """Advertise the tools whose live handlers are bound to a CMS session."""

    def provide_agent_tools(self) -> list[dict]:
        return [CMS_AI_AGENT_TOOLS]

    def invoke_action(
        self,
        action: str,
        payload: dict | None = None,
        tenant_id: str | None = None,
    ) -> dict:
        if action == "capabilities":
            return {"worker": "worker-cms-astro", "browserTools": CMS_AI_AGENT_TOOLS["toolset"]}
        raise ValueError(f"Unsupported action '{action}'")


def extension() -> ReactorExtension:
    return ReactorExtension(
        manifest=ExtensionManifest(
            name="cms-astro-ai-agents",
            version="0.1.0",
            display_name="CMS AI Agents",
            description="AI-assisted authoring for published Astro CMS sites.",
            emoji="✍️",
        ),
        plugins=[(AI_AGENTS_MANIFEST, AiAgentsPlugin())],
        frontend=FrontendExtension(
            directory=find_extension_frontend(__file__, "cms-astro-ai-agents"),
            entry="index.js",
            public_entry="index.js",
            api_version="v1",
            plugins=[
                FrontendPlugin(
                    name="@cms-astro/ai-agents",
                    version="0.1.0",
                    display_name="CMS AI Agents UI",
                    description="Authenticated floating AI authoring assistant.",
                    emoji="✍️",
                    required_backend_plugins=["cms-astro.ai-agents", "cms-astro.core"],
                )
            ],
        ),
    )


__all__ = ["AiAgentsPlugin", "CMS_AI_AGENT_TOOLS", "extension"]
