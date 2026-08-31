# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""`cms` — the CMS application, and the Core extension it ships with.

The package is two things at once, on purpose: an application somebody installs
and runs, and one of the extensions that application loads. Core arriving
through the same entry-point group as `cms-pro` is what keeps the host from
having a privileged idea of its own plugins.
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

from .host import APP_NAME, create_app, main, ui_directory
from .plugins import (
    GALLERY_MANIFEST,
    MARKDOWN_TOOLS_MANIFEST,
    SEO_MANIFEST,
    GalleryPlugin,
    MarkdownToolsPlugin,
    SeoValidatorPlugin,
)

#: Where this extension's frontend is — beside the package in a
#: checkout, under `sys.prefix/share` once the wheel is installed.
_FRONTEND = find_extension_frontend(__file__, "cms-core")


def extension() -> ReactorExtension:
    """The Core extension: three plugins, both tiers, one wheel."""
    return ReactorExtension(
        manifest=ExtensionManifest(
            name="Core",
            version="0.1.0",
            display_name="Core",
            description="The free tier: markdown tools, a gallery, and an SEO gate.",
            octicon="package",
            emoji="🧱",
        ),
        plugins=[
            (MARKDOWN_TOOLS_MANIFEST, MarkdownToolsPlugin()),
            (GALLERY_MANIFEST, GalleryPlugin()),
            (SEO_MANIFEST, SeoValidatorPlugin()),
        ],
        frontend=FrontendExtension(
            directory=_FRONTEND,
            entry="index.js",
            api_version="v1",
            # One module, three plugins — so each is listed, described and
            # switchable on its own while they share a download.
            plugins=[
                FrontendPlugin(
                    name="@cms/markdown-tools",
                    display_name="Markdown Tools",
                    description="Headings, bold and links, in the editor toolbar.",
                    emoji="✍️",
                    export="MarkdownToolsPlugin",
                ),
                FrontendPlugin(
                    name="@cms/gallery",
                    display_name="Gallery",
                    description="A content type for a set of images with captions.",
                    emoji="🖼️",
                    export="GalleryPlugin",
                ),
                FrontendPlugin(
                    name="@cms/seo-validator",
                    display_name="SEO Validator",
                    description="Stops a publish that would be invisible.",
                    emoji="🔎",
                    export="SeoValidatorPlugin",
                ),
            ],
        ),
    )


__all__ = ["APP_NAME", "create_app", "extension", "main", "ui_directory"]
