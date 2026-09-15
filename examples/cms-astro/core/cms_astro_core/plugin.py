# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Backend half of the Core extension."""

from reactor import PluginCompatibility, PluginManifest, define_contribution_point

CONTENT_TYPES = define_contribution_point("cmsAstro.contentType")
THEMES = define_contribution_point("cmsAstro.theme")

CMS_AGENT_TOOLS = {
    "id": "cms-astro",
    "version": "0.1.0",
    "name": "Astro CMS",
    "description": "Import public blogs and create or update content in the authenticated site.",
    "plugin": "@cms-astro/core",
    "toolset": [
        "cms_crawl_blog",
        "cms_crawl_wordpress",
        "cms_create_site_page",
        "cms_update_site_page",
    ],
    "commands": [
        {"name": "cms_crawl_blog", "command": "cmsAstro.crawlBlog"},
        {"name": "cms_crawl_wordpress", "command": "cmsAstro.crawlWordpress"},
        {"name": "cms_create_site_page", "command": "cmsAstro.createSitePage"},
        {"name": "cms_update_site_page", "command": "cmsAstro.updateSitePage"},
    ],
}

CORE_MANIFEST = PluginManifest(
    name="cms-astro.core", version="0.1.0", display_name="CMS Core",
    description="Database collections, publishing, media, menus and taxonomies.",
    emoji="🪐", frontend_dependencies=["@cms-astro/core"],
    compatibility=PluginCompatibility(api_version="v1"),
)


class CorePlugin:
    def provide_routes(self) -> list[dict]:
        return [{"path": "/api/cms", "method": "*", "plugin": "cms-astro.core"}, {"path": "/api/content", "method": "GET", "plugin": "cms-astro.core"}]

    def provide_contributions(self, contributions) -> None:
        for slug, name in (("posts", "Posts"), ("pages", "Pages")):
            contributions.contribute(CONTENT_TYPES, {"slug": slug, "name": name}, contribution_id=slug)
        contributions.contribute(THEMES, {"slug": "editorial", "name": "Editorial"}, contribution_id="editorial")

    def provide_agent_tools(self) -> list[dict]:
        """Advertise the browser tool contract implemented by the Astro site."""
        return [CMS_AGENT_TOOLS]

    def invoke_action(self, action: str, payload: dict | None = None, tenant_id: str | None = None) -> dict:
        if action == "capabilities":
            return {"collections": True, "revisions": True, "search": "fts5", "multiSite": True}
        raise ValueError(f"Unsupported action '{action}'")
