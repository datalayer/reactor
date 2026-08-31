# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""A Reactor extension in one wheel: a Python plugin and the UI that uses it.

This is the whole of issue #12 in one small package. Installing it publishes
both halves — ``pip install -e examples/extension`` against a *running* server
and the panel appears on the next browser refresh, because the platform
rescans entry points when the browser asks what is installed.

The frontend is deliberately un-built: ``share/.../hello/index.js`` is a plain
ES module. That keeps this example about packaging and discovery rather than
about a bundler, and it means the chain is testable before the Rsbuild
migration lands. A real extension would put a built bundle in the same place
and change nothing else here.
"""

from __future__ import annotations

from reactor import (
    ExtensionManifest,
    FrontendExtension,
    FrontendPlugin,
    ReactorExtension,
    find_extension_frontend,
)

from .plugin import HELLO_MANIFEST, HelloPlugin

#: Where the frontend lives.
#:
#: Both places have to work and they are different: an installed wheel puts
#: `share/` under `sys.prefix`, nowhere near the package, while a checkout
#: leaves it in the source tree beside it. `find_extension_frontend` looks in
#: both — looking only beside the package is the bug you get away with until
#: somebody installs the wheel for real.
_FRONTEND = find_extension_frontend(__file__, "hello")


def extension() -> ReactorExtension:
    """What the entry point resolves to: both halves, declared together."""
    return ReactorExtension(
        manifest=ExtensionManifest(
            name="hello",
            version="0.1.0",
            display_name="Hello",
            description="A greeting, delivered by one pip install.",
            octicon="smiley",
            emoji="👋",
        ),
        # The Python half. Registered on the platform like any other plugin,
        # and refused like any other if its dependencies are missing.
        plugins=[(HELLO_MANIFEST, HelloPlugin())],
        # The JavaScript half. Note that the plugin's *manifest* is here, in
        # Python: that is what lets the browser list, describe and switch this
        # plugin off before it has fetched a single byte of `index.js`.
        frontend=FrontendExtension(
            directory=_FRONTEND,
            entry="index.js",
            api_version="v1",
            plugins=[
                FrontendPlugin(
                    name="@hello/panel",
                    version="0.1.0",
                    display_name="Hello panel",
                    description=(
                        "Contributed to the sidebar by an extension that was "
                        "pip-installed while the server was running."
                    ),
                    octicon="smiley",
                    emoji="👋",
                    # It reads the greeting from its own Python half, so it
                    # says so — and stops rendering if that plugin is switched
                    # off in the Plugins panel.
                    required_backend_plugins=["hello"],
                ),
            ],
        ),
    )


__all__ = ["extension"]
