# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Core CMS host and Reactor extension."""

from reactor import ExtensionManifest, FrontendExtension, FrontendPlugin, ReactorExtension, find_extension_frontend

from .host import create_app, main
from .plugin import CORE_MANIFEST, CorePlugin


def extension() -> ReactorExtension:
    return ReactorExtension(
        manifest=ExtensionManifest(name="cms-astro-core", version="0.1.0", display_name="CMS Core", description="Astro CMS essentials", emoji="🪐"),
        plugins=[(CORE_MANIFEST, CorePlugin())],
        frontend=FrontendExtension(
            directory=find_extension_frontend(__file__, "cms-astro-core"), entry="index.js", api_version="v1",
            plugins=[FrontendPlugin(name="@cms-astro/core", version="0.1.0", display_name="CMS Core UI", description="Core content types, themes and dashboard", emoji="🪐", required_backend_plugins=["cms-astro.core"])],
        ),
    )


__all__ = ["create_app", "extension", "main"]

