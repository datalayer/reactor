# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""The music store's host: every plugin, and the interface, from one install.

A plugin platform is composed by an application, not by its plugins. Each plugin
package here ships its own standalone ``create_app`` for running it alone; this
is what runs them *together* — and, unlike the four-terminal version this
replaces, it also serves the browser half.

    pip install datalayer_music_example
    datalayer-music-example

There is no second build to deploy and no URL to configure between the halves,
because there are no halves at the deployment level: the interface is served
from the same origin as the API it calls.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI

from catalog_plugin import catalog_router, register as register_catalog
from checkout_plugin import build_checkout_router, register as register_checkout
from mood_plugin import register as register_mood
from playlist_plugin import build_router as build_playlist_router, register as register_playlist
from reactor import (
    PluginPlatform,
    create_reactor_host,
    find_ui,
    mount_reactor_ui,
    serve,
)

#: Name of this application's UI directory, under `share/datalayer/reactor/apps`.
APP_NAME = "music"


def ui_directory() -> Path | None:
    """Where this host's built interface is, in a wheel or a source checkout.

    ``find_ui`` looks in the wheel's ``share/`` first. The fallback below is the
    development loop: a checkout has no ``share/``, and what it does have is
    whatever ``npm run build`` last wrote next door — so ``pip install -e`` plus
    a frontend build is a working setup rather than a special case.
    """
    from_wheel = find_ui(__file__, APP_NAME)
    if from_wheel is not None:
        return from_wheel

    checkout = Path(__file__).resolve().parents[2] / "app" / "dist"
    return checkout if (checkout / "index.html").is_file() else None


def create_app(*, with_ui: bool = True) -> FastAPI:
    """Compose every music plugin on one platform and serve it.

    Registration order is the dependency order the platform enforces: it refuses
    a plugin whose declared dependencies are not registered yet, so ``checkout``
    and ``playlist`` follow ``catalog``, and ``mood`` follows ``playlist``.
    """
    platform = PluginPlatform()
    register_catalog(platform)
    register_checkout(platform)
    register_playlist(platform)
    register_mood(platform)

    app = create_reactor_host(
        platform,
        title="Reactor Music",
        # Anything installed beside this host joins in — which is how
        # `examples/extension` appears in the store's sidebar.
        discover=True,
    )

    app.include_router(catalog_router)
    app.include_router(build_checkout_router(platform))
    # Both are built from the platform rather than imported: the playlist routes
    # read their rules per request, so toggling `mood` changes the answer live.
    app.include_router(build_playlist_router(platform))

    # Last, and only last: this adds a catch-all, and every route above it must
    # win. An API that starts answering with `index.html` is the failure this
    # ordering exists to prevent.
    if with_ui:
        mount_reactor_ui(app, ui_directory())

    return app


def main() -> None:
    """The `datalayer-music-example` console script."""
    serve(
        create_app,
        description="Serve the Reactor music store: every plugin, and its interface.",
        default_port=8799,
    )
