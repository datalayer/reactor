"""Optional Pro extension; discovered without changing Core."""

from reactor import ExtensionManifest, FrontendExtension, FrontendPlugin, PluginCompatibility, PluginManifest, ReactorExtension, define_contribution_point, find_extension_frontend

EDITOR_ACTIONS = define_contribution_point("cmsAstro.editorAction")
THEMES = define_contribution_point("cmsAstro.theme")

PRO_MANIFEST = PluginManifest(
    name="cms-astro.pro", version="0.1.0", display_name="CMS Pro",
    description="SEO analysis, editorial scheduling, audit and premium themes.", emoji="💫",
    frontend_dependencies=["@cms-astro/pro"], compatibility=PluginCompatibility(api_version="v1"),
)


class ProPlugin:
    def provide_contributions(self, contributions) -> None:
        contributions.contribute(EDITOR_ACTIONS, {"id":"seo","name":"SEO analysis"}, contribution_id="seo")
        contributions.contribute(THEMES, {"slug":"midnight","name":"Midnight Pro"}, contribution_id="midnight")

    def invoke_action(self, action: str, payload: dict | None = None, tenant_id: str | None = None) -> dict:
        if action != "analyze":
            raise ValueError(f"Unsupported action '{action}'")
        value = payload or {}
        title, body = str(value.get("title", "")), str(value.get("body", ""))
        words = len(body.split())
        checks = {"titleLength": 10 <= len(title) <= 60, "minimumWords": words >= 100, "hasHeading": "#" in body}
        return {"score": round(100 * sum(checks.values()) / len(checks)), "checks": checks, "words": words}


def extension() -> ReactorExtension:
    return ReactorExtension(
        manifest=ExtensionManifest(name="cms-astro-pro", version="0.1.0", display_name="CMS Pro", description="Advanced editorial tools", emoji="💫"),
        plugins=[(PRO_MANIFEST, ProPlugin())],
        frontend=FrontendExtension(
            directory=find_extension_frontend(__file__, "cms-astro-pro"), entry="index.js", api_version="v1",
            plugins=[FrontendPlugin(name="@cms-astro/pro", version="0.1.0", display_name="CMS Pro UI", description="SEO, campaigns and premium themes", emoji="💫", required_backend_plugins=["cms-astro.pro"])],
        ),
    )


__all__ = ["extension"]

