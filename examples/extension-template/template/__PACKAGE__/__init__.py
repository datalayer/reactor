# Copyright (c) 2026-Present Datalayer, Inc.
#
# BSD 3-Clause License

"""The __NAME__ extension: both halves, declared in one place.

The frontend plugin's *manifest* lives here, in Python, so a host can list,
describe and switch it before fetching a byte of its JavaScript. The code
itself is the Module Federation container that `frontend/` builds into
`share/`; `kind="federated"` is what tells the browser to load it as one.
"""

from __future__ import annotations

from pathlib import Path

from reactor import (
    SHARE_DIRECTORY,
    ExtensionManifest,
    FrontendExtension,
    FrontendPlugin,
    ReactorExtension,
    find_extension_frontend,
)

from ._version import __version__
from .plugin import MANIFEST, Plugin

# Found in a wheel (under sys.prefix/share) and in a checkout (beside this
# package) alike. Not found is a checkout whose frontend was never built: it is
# pointed at where the build will write, and the host refuses it for recording
# no version — said in the log and in the browser, rather than silently absent.
_FRONTEND = find_extension_frontend(__file__, "__NAME__") or (
    Path(__file__).resolve().parent.parent / SHARE_DIRECTORY / "__NAME__"
)


def extension() -> ReactorExtension:
    return ReactorExtension(
        manifest=ExtensionManifest(
            name="__NAME__",
            version=__version__,
            display_name="__NAME__",
            description="Describe the capability, not the code.",
            octicon="package",
        ),
        plugins=[(MANIFEST, Plugin())],
        frontend=FrontendExtension(
            directory=_FRONTEND,
            entry="remoteEntry.js",
            # The build in `directory` must say the same version (the
            # package.json it copies there), or the frontend is refused: one
            # wheel, one version.
            version=__version__,
            api_version="v1",
            kind="federated",
            # Must match `name` in frontend/rsbuild.config.ts.
            remote_name="__PACKAGE__",
            # Must match the key in `exposes` there.
            module="./plugin",
            plugins=[
                FrontendPlugin(
                    # Must match `name` in frontend/src/plugin.tsx.
                    name="__PLUGIN__",
                    version=__version__,
                    display_name="__NAME__",
                    description="The browser half of __NAME__.",
                    # Its panel only renders while the Python half is enabled.
                    required_backend_plugins=["__NAME__"],
                ),
            ],
        ),
    )
