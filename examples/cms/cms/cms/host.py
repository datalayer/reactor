# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""The CMS application: a host that serves its interface and finds its plugins.

    pip install cms
    datalayer-cms

Everything the CMS *does* is a plugin, including the three that ship in this
package — they are discovered through the entry-point group like any other, so
the free tier arrives by exactly the mechanism a paid one would. Installing
``cms-pro`` beside this adds three more, to the same three points, with no
change here and no rebuild of the interface.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI

from reactor import PluginPlatform, create_reactor_host, find_ui, mount_reactor_ui, serve

APP_NAME = "cms"


def ui_directory() -> Path | None:
    """The built interface, in the wheel or in a source checkout."""
    from_wheel = find_ui(__file__, APP_NAME)
    if from_wheel is not None:
        return from_wheel
    checkout = Path(__file__).resolve().parents[2] / "app" / "dist"
    return checkout if (checkout / "index.html").is_file() else None


def create_app(*, with_ui: bool = True) -> FastAPI:
    """The whole application.

    Note what is *not* here: no plugin is registered by name. The host scans the
    entry-point group and takes what it finds, which is why this function does
    not change when a package is installed beside it.
    """
    app = create_reactor_host(PluginPlatform(), title="Reactor CMS", discover=True)
    if with_ui:
        mount_reactor_ui(app, ui_directory())
    return app


def main() -> None:
    """The `datalayer-cms` console script."""
    serve(
        create_app,
        description="Serve the Reactor CMS: whatever plugins are installed beside it.",
        default_port=8788,
    )
