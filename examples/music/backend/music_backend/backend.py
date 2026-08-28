# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""The music example's backend host.

A plugin platform is composed by an application, not by its plugins. Each plugin
package here ships its own standalone ``create_app`` for running it alone; this
package is the host that runs them *together*, in dependency order, on one
platform — which is what the frontend's Plugins panel talks to.

The reactor's own management API comes with :func:`create_reactor_app`:

* ``GET  /plugins`` — every registered plugin and whether it is enabled,
* ``POST /plugins/{name}/toggle`` — enable or disable one at runtime.

Those two are the whole backend half of the Plugins panel. Disabling ``catalog``
here makes the frontend's catalog and shop cards disappear, because their React
extensions declare ``requiredBackendPlugins: ['catalog']``; disabling ``mood``
empties the playlist's rule list, because the platform stops counting a disabled
plugin's contributions.

Run with::

    uvicorn music_backend.app:app --reload --port 8799
"""

from __future__ import annotations

from fastapi import FastAPI

from catalog_plugin import catalog_router, register as register_catalog
from checkout_plugin import build_checkout_router, register as register_checkout
from mood_plugin import register as register_mood
from playlist_plugin import build_router as build_playlist_router, register as register_playlist
from reactor import PluginPlatform, create_reactor_app


def create_app() -> FastAPI:
    """Compose every music plugin on one platform and serve it.

    Registration order is the dependency order the platform enforces: it refuses
    a plugin whose declared dependencies are not registered yet, so ``checkout``
    and ``playlist`` follow ``catalog``, and ``mood`` follows ``playlist``.
    """
    reactor = PluginPlatform()
    register_catalog(reactor)
    register_checkout(reactor)
    register_playlist(reactor)
    register_mood(reactor)
    reactor.start()

    app = create_reactor_app(reactor)
    app.include_router(catalog_router)
    app.include_router(build_checkout_router(reactor))
    # Both are built from the platform rather than imported: the playlist
    # routes read their rules per request, so toggling `mood` changes the
    # answer live, and checkout invokes its plugin through the platform.
    app.include_router(build_playlist_router(reactor))
    return app


