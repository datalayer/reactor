# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Mood plugin backend — the plugin that *uses* another plugin's point.

It serves no routes and owns no data. Everything it offers reaches the frontend
through the playlist backend, which owns ``music.playlist.rule`` and decides
which rule answers a request.

The direction of the dependency is the lesson: the playlist backend does not
import this package and works without it, while this one declares
``dependencies=["playlist"]`` because a contribution is worthless without the
point it is made to.

Contributions are declared in ``provide_contributions``, which the platform
calls once at registration. Disabling this plugin does not unregister it — the
platform simply stops counting its contributions, so ``GET /api/playlist/rules``
goes empty and comes back unchanged when it is enabled again.
"""

from __future__ import annotations

from catalog_plugin import Song
from playlist_plugin import PLAYLIST_RULE, PlaylistRule
from reactor import (
    PluginCompatibility,
    PluginContributions,
    PluginManifest,
    PluginPlatform,
)
from reactor.hooks import hookimpl


def _sorted_by(songs: list[Song], key, reverse: bool = False) -> list[Song]:
    """Sort a copy: a rule is handed the catalog, it does not own it."""
    return sorted(songs, key=key, reverse=reverse)


#: An unhurried listen: the cheapest tracks, kept to four. Any rule may return
#: a subset — this is how one filters.
CHILL = PlaylistRule(
    title="Chill",
    description="Four gentle tracks, cheapest first",
    select=lambda songs: _sorted_by(songs, key=lambda song: song.price)[:4],
)

#: The other end, and the whole catalog rather than a slice.
ENERGETIC = PlaylistRule(
    title="Energetic",
    description="Everything, loudest bill first",
    select=lambda songs: _sorted_by(songs, key=lambda song: song.price, reverse=True),
)

#: A rule needs no ranking at all — alphabetical is a mood too.
ALPHABETICAL = PlaylistRule(
    title="A to Z",
    description="Every track, by title",
    select=lambda songs: _sorted_by(songs, key=lambda song: song.title),
)


MOOD_MANIFEST = PluginManifest(
    name="mood",
    version="1.0.0",
    description="Playlist rules contributed to the playlist plugin",
    dependencies=["playlist"],
    compatibility=PluginCompatibility(api_version="v1"),
)


class MoodPlugin:
    """Reactor plugin contributing rules, and nothing else."""

    @hookimpl
    def on_reactor_start(self, tenant_id: str | None = None) -> None:
        print(f"[MoodPlugin] started tenant={tenant_id}")

    @hookimpl
    def on_reactor_stop(self, tenant_id: str | None = None) -> None:
        print(f"[MoodPlugin] stopped tenant={tenant_id}")

    def provide_contributions(self, contributions: PluginContributions) -> None:
        """Offer three rules at the playlist plugin's extension point.

        The platform hands in a view bound to this plugin's name, so the rules
        are attributed here and disposed with it.
        """
        contributions.contribute(PLAYLIST_RULE, CHILL, contribution_id="chill", order=0)
        contributions.contribute(
            PLAYLIST_RULE, ENERGETIC, contribution_id="energetic", order=1
        )
        contributions.contribute(
            PLAYLIST_RULE, ALPHABETICAL, contribution_id="a-to-z", order=2
        )


def register(reactor: PluginPlatform) -> None:
    """Register the mood plugin. The playlist plugin must be registered first."""
    reactor.register_plugin(MOOD_MANIFEST, MoodPlugin())
