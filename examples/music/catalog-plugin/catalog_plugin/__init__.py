# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Catalog backend plugin package."""

from .catalog import (
    CATALOG_MANIFEST,
    SONGS,
    CatalogPlugin,
    Song,
    catalog_router,
    create_app,
    list_songs,
    plugin,
    register,
)

__all__ = [
    "CATALOG_MANIFEST",
    "SONGS",
    "CatalogPlugin",
    "Song",
    "catalog_router",
    "create_app",
    "list_songs",
    "plugin",
    "register",
]
