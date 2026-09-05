# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""A Reactor extension whose frontend is a Module Federation container.

The sibling ``examples/extension`` ships a plain ES module: one file, imported
from its URL, borrowing React off a global. This one ships a *container* —
``remoteEntry.js`` plus whatever chunks a real build produces — and says so
with three fields on :class:`FrontendExtension`: ``kind="federated"``, the
container's ``remote_name``, and the ``module`` it exposes. The server puts
the same three on the wire, and the browser's ``bootstrapExtensions`` picks
the federation loader from them. Nothing else changes: same entry point, same
``share/`` directory, same one ``pip install``.

The container here is written by hand (see ``share/…/remoteEntry.js``) so the
example needs no build step to run; ``frontend/`` beside it is the Rsbuild
configuration that emits the real thing into the same directory.
"""

from __future__ import annotations

from reactor import (
    ExtensionManifest,
    FrontendExtension,
    FrontendPlugin,
    ReactorExtension,
    find_extension_frontend,
)

from .plugin import HELLO_FEDERATED_MANIFEST, HelloFederatedPlugin

_FRONTEND = find_extension_frontend(__file__, "hello-federated")


def extension() -> ReactorExtension:
    """What the entry point resolves to: both halves, one of them a container."""
    return ReactorExtension(
        manifest=ExtensionManifest(
            name="hello-federated",
            version="0.1.0",
            display_name="Hello (federated)",
            description="A greeting delivered as a Module Federation container.",
            octicon="package",
            emoji="📦",
        ),
        plugins=[(HELLO_FEDERATED_MANIFEST, HelloFederatedPlugin())],
        frontend=FrontendExtension(
            directory=_FRONTEND,
            # The container entry, not a module: what a bundler emits.
            entry="remoteEntry.js",
            api_version="v1",
            # The three fields that make it a container to the browser.
            kind="federated",
            remote_name="hello_federated",
            module="./plugin",
            # The hand-written entry is an ES module. A built one is a
            # `global` script, and would leave this out.
            remote_type="esm",
            plugins=[
                FrontendPlugin(
                    name="@hello/federated-panel",
                    version="0.1.0",
                    display_name="Hello federated panel",
                    description="Its React came through the share scope, not a global.",
                    required_backend_plugins=["hello-federated"],
                ),
            ],
        ),
    )
