# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""The Pro extension's three plugins, on the Python tier.

Each one fills a point the free tier already fills. That is deliberate and is
the whole reason this example has two packages: **the paid plugins are not
special**. They arrive through the same entry-point group, register on the same
platform, and contribute to the same three ids. Nothing in the host or in the
free tier knows one of them was paid for.
"""

from __future__ import annotations

from reactor import PluginCompatibility, PluginManifest, define_contribution_point
from reactor.hooks import hookimpl

# The same three ids the free tier and the browser use. Declared here rather
# than imported from `cms`: an extension that had to import another extension
# would be a fork of it.
EDITOR_TOOLBAR = define_contribution_point("cms.editorToolbar")
CONTENT_TYPES = define_contribution_point("cms.contentType")
PUBLISH_LIFECYCLE = define_contribution_point("cms.publishLifecycle")

_COMPAT = PluginCompatibility(api_version="v1")


AI_ASSISTANT_MANIFEST = PluginManifest(
    name="cms.ai-writing-assistant",
    version="0.1.0",
    display_name="AI Writing Assistant",
    description="Rewrites a draft, and offers suggestions beside the editor.",
    octicon="sparkles-fill",
    emoji="🤖",
    optional_frontend_dependencies=["@cms-pro/ai-writing-assistant"],
    compatibility=_COMPAT,
)


class AiWritingAssistantPlugin:
    @hookimpl
    def on_reactor_start(self, tenant_id: str | None = None) -> None:
        print("[cms-pro] AI Writing Assistant started")

    def provide_contributions(self, contributions) -> None:
        contributions.contribute(
            EDITOR_TOOLBAR,
            {"id": "rewrite", "label": "Rewrite", "tier": "pro"},
            contribution_id="rewrite",
        )


PRODUCT_MANIFEST = PluginManifest(
    name="cms.product",
    version="0.1.0",
    display_name="Product",
    description="A content type with a price, stock and a buy link.",
    octicon="tag",
    emoji="🏷️",
    compatibility=_COMPAT,
)


class ProductPlugin:
    def provide_contributions(self, contributions) -> None:
        contributions.contribute(
            CONTENT_TYPES,
            {"id": "product", "label": "Product", "fields": ["price", "sku"]},
            contribution_id="product",
        )


SOCIAL_MANIFEST = PluginManifest(
    name="cms.social-publisher",
    version="0.1.0",
    display_name="Social Publisher",
    description="Announces a published document, and never blocks one.",
    octicon="broadcast",
    emoji="📣",
    compatibility=_COMPAT,
)


class SocialPublisherPlugin:
    """The lifecycle's other shape: a step that acts rather than gates.

    Both kinds fill the same point. A publish lifecycle whose steps could only
    veto would have no room for this one, and one whose steps could only observe
    would have no room for the SEO validator.
    """

    def provide_contributions(self, contributions) -> None:
        contributions.contribute(
            PUBLISH_LIFECYCLE,
            {"id": "social", "label": "Social", "blocking": False},
            contribution_id="social",
        )
