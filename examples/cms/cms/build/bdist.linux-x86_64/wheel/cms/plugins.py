# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""The Core extension's three plugins, on the Python tier.

Each has a counterpart in the browser — see
``share/datalayer/reactor/extensions/cms-core/index.js`` — and each contributes
to the *same three points* the frontend does, by the same ids. So a headless
client can ask the server what content types exist and get the same answer the
editor draws, which is what makes these points a contract rather than a UI
detail.
"""

from __future__ import annotations

from reactor import PluginCompatibility, PluginManifest, define_contribution_point
from reactor.hooks import hookimpl

#: The three points this CMS opens. The ids are the contract, and they are the
#: same strings the browser uses — that is the only thing making the two tiers
#: talk about the same thing.
EDITOR_TOOLBAR = define_contribution_point("cms.editorToolbar")
CONTENT_TYPES = define_contribution_point("cms.contentType")
PUBLISH_LIFECYCLE = define_contribution_point("cms.publishLifecycle")

_COMPAT = PluginCompatibility(api_version="v1")


MARKDOWN_TOOLS_MANIFEST = PluginManifest(
    name="cms.markdown-tools",
    version="0.1.0",
    display_name="Markdown Tools",
    description="Headings, bold, and a link — the toolbar every editor starts with.",
    octicon="typography",
    emoji="✍️",
    contribution_points=["cms.editorToolbar"],
    optional_frontend_dependencies=["@cms/markdown-tools"],
    compatibility=_COMPAT,
)


class MarkdownToolsPlugin:
    """Server-side twin of the toolbar, for clients that are not a browser."""

    @hookimpl
    def on_reactor_start(self, tenant_id: str | None = None) -> None:
        print("[cms] Markdown Tools started")

    def provide_contributions(self, contributions) -> None:
        for tool_id, label in (("heading", "Heading"), ("bold", "Bold"), ("link", "Link")):
            contributions.contribute(
                EDITOR_TOOLBAR,
                {"id": tool_id, "label": label},
                contribution_id=tool_id,
            )


GALLERY_MANIFEST = PluginManifest(
    name="cms.gallery",
    version="0.1.0",
    display_name="Gallery",
    description="A content type for a set of images with captions.",
    octicon="image",
    emoji="🖼️",
    compatibility=_COMPAT,
)


class GalleryPlugin:
    def provide_contributions(self, contributions) -> None:
        contributions.contribute(
            CONTENT_TYPES,
            {"id": "gallery", "label": "Gallery", "fields": ["caption", "alt"]},
            contribution_id="gallery",
        )


SEO_MANIFEST = PluginManifest(
    name="cms.seo-validator",
    version="0.1.0",
    display_name="SEO Validator",
    description="Refuses to publish a document that would be invisible.",
    octicon="search",
    emoji="🔎",
    compatibility=_COMPAT,
)


class SeoValidatorPlugin:
    """The reason the publish lifecycle can *veto*.

    A lifecycle whose steps could only observe would make this plugin a
    suggestion. Being able to answer "no" is what makes it a validator.
    """

    def provide_contributions(self, contributions) -> None:
        contributions.contribute(
            PUBLISH_LIFECYCLE,
            {"id": "seo", "label": "SEO", "blocking": True},
            contribution_id="seo",
        )
