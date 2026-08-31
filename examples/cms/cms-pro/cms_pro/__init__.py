# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""`cms-pro` — the paid tier, as an ordinary extension.

There is no plugin API for paid plugins, because there is no reason for one.
This package advertises itself under the same entry-point group as `cms`,
registers on the same platform, and fills the same three points. What makes it
"pro" is who may download the wheel — a question about distribution, answered
entirely outside the extension mechanism.
"""

from __future__ import annotations

from pathlib import Path

from reactor import (
    ExtensionManifest,
    FrontendExtension,
    FrontendPlugin,
    ReactorExtension,
    find_extension_frontend,
)

from .plugins import (
    AI_ASSISTANT_MANIFEST,
    PRODUCT_MANIFEST,
    SOCIAL_MANIFEST,
    AiWritingAssistantPlugin,
    ProductPlugin,
    SocialPublisherPlugin,
)

#: Where this extension's frontend is — beside the package in a
#: checkout, under `sys.prefix/share` once the wheel is installed.
_FRONTEND = find_extension_frontend(__file__, "cms-pro")


def extension() -> ReactorExtension:
    """The Pro extension: three plugins, both tiers, one wheel."""
    return ReactorExtension(
        manifest=ExtensionManifest(
            name="Pro",
            version="0.1.0",
            display_name="Pro",
            description="The paid tier: an assistant, a product type, and social publishing.",
            octicon="star",
            emoji="⭐",
        ),
        plugins=[
            (AI_ASSISTANT_MANIFEST, AiWritingAssistantPlugin()),
            (PRODUCT_MANIFEST, ProductPlugin()),
            (SOCIAL_MANIFEST, SocialPublisherPlugin()),
        ],
        frontend=FrontendExtension(
            directory=_FRONTEND,
            entry="index.js",
            api_version="v1",
            plugins=[
                FrontendPlugin(
                    name="@cms-pro/ai-writing-assistant",
                    display_name="AI Writing Assistant",
                    description="Rewrites a draft, and suggests beside the editor.",
                    emoji="🤖",
                    export="AiWritingAssistantPlugin",
                ),
                FrontendPlugin(
                    name="@cms-pro/product",
                    display_name="Product",
                    description="A content type with a price and a SKU.",
                    emoji="🏷️",
                    export="ProductPlugin",
                ),
                FrontendPlugin(
                    name="@cms-pro/social-publisher",
                    display_name="Social Publisher",
                    description="Announces a publish. Never blocks one.",
                    emoji="📣",
                    export="SocialPublisherPlugin",
                ),
            ],
        ),
    )


__all__ = ["extension"]
