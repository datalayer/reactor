"""Catalog backend plugin package."""

from .catalog import (
    CATALOG_MANIFEST,
    SONGS,
    CatalogPlugin,
    Song,
    catalog_router,
    create_app,
    list_songs,
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
    "register",
]
