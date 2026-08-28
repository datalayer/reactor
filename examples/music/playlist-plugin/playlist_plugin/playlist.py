# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Playlist plugin backend — the plugin that *offers an extension point*.

The frontend twin of this package (``playlist-plugin/src/index.tsx``) opens
``music.playlistRule`` for React plugins. This is the same idea on the server:
the playlist backend owns the endpoint and the catalog it reads, and asks other
backend plugins "what ways of choosing songs do you know?".

It ships no rules itself. Started alone it serves an empty rule list, which is
what ``GET /api/playlist/rules`` returns when the mood plugin is disabled from
the Plugins panel — the platform filters contributions by enablement, so a
disabled plugin's rules stop being served without anything being unregistered.

Run standalone with::

    uvicorn playlist_plugin.app:app --reload --port 8799
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from fastapi import APIRouter, FastAPI, HTTPException
from pydantic import BaseModel

from catalog_plugin import (
    Song,
    catalog_router,
    list_songs,
    register as register_catalog,
)
from reactor import (
    PluginCompatibility,
    PluginManifest,
    PluginPlatform,
    create_reactor_app,
    define_extension_point,
)
from reactor.hooks import hookimpl


@dataclass(frozen=True)
class PlaylistRule:
    """What a plugin offers when it extends the playlist.

    ``select`` is the whole contract: given the catalog, return the songs this
    rule wants, in the order it wants them. A subset is how a rule filters; a
    reordering is how it ranks.
    """

    title: str
    description: str
    select: Callable[[list[Song]], list[Song]]


#: The extension point. Its id is the contract between plugins — the mood
#: backend contributes to this exact string.
PLAYLIST_RULE = define_extension_point("music.playlistRule")


class RuleInfo(BaseModel):
    """One rule, as the frontend sees it (the callable stays on the server)."""

    id: str
    title: str
    description: str
    plugin: str


PLAYLIST_MANIFEST = PluginManifest(
    name="playlist",
    version="1.0.0",
    display_name="Playlist",
    description="Opens the music.playlistRule extension point and serves what is contributed to it.",
    octicon="list-unordered",
    emoji="🎧",
    dependencies=["catalog"],
    # The point this plugin opens, declared so a host can draw it even before
    # anything is contributed to it.
    extension_points=["music.playlistRule"],
    # Optional: these routes answer `curl` perfectly well on their own. The
    # frontend playlist is what makes them *visible*, not what makes them work.
    optional_frontend_dependencies=["@music/playlist"],
    compatibility=PluginCompatibility(api_version="v1"),
)


class PlaylistPlugin:
    """Reactor plugin owning the playlist and its extension point."""

    @hookimpl
    def on_reactor_start(self, tenant_id: str | None = None) -> None:
        print(f"[PlaylistPlugin] started tenant={tenant_id}")

    @hookimpl
    def on_reactor_stop(self, tenant_id: str | None = None) -> None:
        print(f"[PlaylistPlugin] stopped tenant={tenant_id}")

    def provide_routes(self) -> list[dict]:
        return [
            {"path": "/api/playlist/rules", "method": "GET", "plugin": "playlist"},
            {"path": "/api/playlist", "method": "GET", "plugin": "playlist"},
        ]


def build_router(reactor: PluginPlatform) -> APIRouter:
    """The playlist routes, reading whatever is contributed *right now*.

    The platform is captured rather than the rules: contributions are read per
    request, so enabling or disabling the mood plugin changes what these
    endpoints answer without a restart.
    """
    router = APIRouter()

    def rules() -> list[tuple[str, str, PlaylistRule]]:
        return [
            (entry.id, entry.plugin, entry.value)
            for entry in reactor.get_contributions(PLAYLIST_RULE)
        ]

    @router.get("/api/playlist/rules", response_model=list[RuleInfo])
    def get_rules() -> list[RuleInfo]:
        return [
            RuleInfo(
                id=rule_id,
                title=rule.title,
                description=rule.description,
                plugin=plugin,
            )
            for rule_id, plugin, rule in rules()
        ]

    @router.get("/api/playlist", response_model=list[Song])
    def get_playlist(rule: str | None = None) -> list[Song]:
        available = rules()
        if not available:
            return []
        chosen = next(
            (entry for entry in available if entry[0] == rule),
            available[0] if rule is None else None,
        )
        if chosen is None:
            raise HTTPException(status_code=404, detail=f"No playlist rule '{rule}'")
        return chosen[2].select(list_songs())

    return router


def register(reactor: PluginPlatform) -> None:
    """Register the playlist plugin. The catalog must be registered first."""
    reactor.register_plugin(PLAYLIST_MANIFEST, PlaylistPlugin())


def create_app() -> FastAPI:
    """Standalone app: catalog + playlist, and no rules to choose from."""
    reactor = PluginPlatform()
    register_catalog(reactor)
    register(reactor)
    reactor.start()
    app = create_reactor_app(reactor)
    app.include_router(catalog_router)
    app.include_router(build_router(reactor))
    return app
