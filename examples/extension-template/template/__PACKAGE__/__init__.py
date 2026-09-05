"""The __NAME__ extension: both halves, declared in one place.

The frontend plugin's *manifest* lives here, in Python, so a host can list,
describe and switch it before fetching a byte of its JavaScript. The code
itself is the Module Federation container that `frontend/` builds into
`share/`; `kind="federated"` is what tells the browser to load it as one.
"""

from __future__ import annotations

from reactor import (
    ExtensionManifest,
    FrontendExtension,
    FrontendPlugin,
    ReactorExtension,
    find_extension_frontend,
)

from .plugin import MANIFEST, Plugin

# Found in a wheel (under sys.prefix/share) and in a checkout (beside this
# package) alike; None means no frontend was built yet, which is allowed.
_FRONTEND = find_extension_frontend(__file__, "__NAME__")


def extension() -> ReactorExtension:
    return ReactorExtension(
        manifest=ExtensionManifest(
            name="__NAME__",
            version="0.1.0",
            display_name="__NAME__",
            description="Describe the capability, not the code.",
            octicon="package",
        ),
        plugins=[(MANIFEST, Plugin())],
        frontend=FrontendExtension(
            directory=_FRONTEND,
            entry="remoteEntry.js",
            api_version="v1",
            kind="federated",
            remote_name="__PACKAGE__",
            module="./plugin",
            plugins=[
                FrontendPlugin(
                    name="__PLUGIN__",
                    version="0.1.0",
                    display_name="__NAME__",
                    required_backend_plugins=["__NAME__"],
                ),
            ],
        )
        if _FRONTEND is not None
        else None,
    )
