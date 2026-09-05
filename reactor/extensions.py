# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Extensions that ship both tiers in one distribution.

A capability is rarely one plugin, and in an application with a server it is
rarely one *language*. The checkout view and the endpoint that prices a cart
are one thing to install and one thing to uninstall; asking somebody to
``pip install`` one half and ``npm install`` the other, and to keep the two at
the same version by hand, is asking them to do the platform's job.

So a :class:`ReactorExtension` is a Python distribution carrying both: the
plugins that run here, and the JavaScript that runs in the browser. It
advertises itself through an entry point, which means **installing it is
publishing it** — nothing is hardcoded in the host.

The part worth understanding is why the *frontend* plugins are described here,
in Python, rather than left inside the JavaScript. It is the same split the
runtime already rests on: a manifest is readable without running anything, so a
plugin can be listed, described, drawn and switched off while its code has
never been fetched. Extending that across the wire is what lets a browser paint
a complete plugin list on the first frame — and what makes a plugin that is
installed but *unloadable* (a refused version, a blocked origin) a state the
host can show rather than an absence nobody can explain.

@see :mod:`reactor.reactor` for discovery, and ``GET /plugins/frontend-extensions``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .types import ExtensionManifest, PluginManifest

#: The entry-point group an extension advertises itself under.
#:
#: One group for both tiers, deliberately: an extension that delivered only a
#: backend would still be discovered here, and the frontend half is simply
#: absent rather than living somewhere else.
EXTENSION_ENTRY_POINT_GROUP = "datalayer.reactor.extensions"

#: Where a wheel puts data Reactor serves, relative to ``sys.prefix``.
#:
#: Borrowed from JupyterLab rather than invented: ``share/`` is where the
#: Python packaging tools already agree that non-Python data belongs, and a
#: convention somebody has already debugged is worth more than a better one.
SHARE_ROOT = "share/datalayer/reactor"

#: Where a wheel puts an extension's built frontend.
SHARE_DIRECTORY = f"{SHARE_ROOT}/extensions"


def find_share(package_file: str | Path, relative: str) -> Path | None:
    """Find a ``share/`` directory, in a wheel *or* in a source checkout.

    Both have to work, and they put it in different places:

    * an **installed wheel** puts it under ``sys.prefix/share/...``, nowhere
      near the package — data files and Python packages are separate
      destinations, which is exactly the trap this function exists to spring;
    * an **editable install or a checkout** leaves it in the source tree, beside
      the package.

    Looking only beside the package is the bug you get away with until somebody
    installs the wheel for real. Returns ``None`` when neither exists, which is
    an extension with no frontend — a legitimate thing to be.
    """
    import sys

    here = Path(package_file).resolve().parent
    for parent in [here, *here.parents][:6]:
        candidate = parent / SHARE_ROOT / relative
        if candidate.is_dir():
            return candidate

    candidate = Path(sys.prefix) / SHARE_ROOT / relative
    return candidate if candidate.is_dir() else None


def find_extension_frontend(package_file: str | Path, name: str) -> Path | None:
    """Where this extension's built frontend is. See :func:`find_share`."""
    return find_share(package_file, f"extensions/{name}")


@dataclass(frozen=True)
class FrontendPlugin:
    """One browser-side plugin, as its manifest — without its code.

    Field for field, this is what the TypeScript ``LazyPluginRef`` needs before
    its module lands. A host reads it, lists the plugin, draws it on the graph
    and offers a switch for it, and only fetches the module when something
    actually asks.
    """

    #: The identifier other plugins depend on, e.g. ``@hello/panel``.
    name: str
    version: str = ""
    display_name: str = ""
    description: str = ""
    octicon: str = ""
    emoji: str = ""
    #: Frontend plugins this one must activate after.
    dependencies: list[str] = field(default_factory=list)
    #: Empty means "at startup", exactly as in the TypeScript runtime.
    activation_events: list[str] = field(default_factory=list)
    deactivation_events: list[str] = field(default_factory=list)
    #: Backend plugins whose absence stops this plugin's slots rendering.
    required_backend_plugins: list[str] = field(default_factory=list)
    optional_backend_plugins: list[str] = field(default_factory=list)
    #: Which export of the module holds the plugin. Empty means the default.
    export: str = ""

    @property
    def title(self) -> str:
        """What to print. Falls back to the identifier, so there is always one."""
        return self.display_name or self.name

    def to_dict(self) -> dict[str, Any]:
        """The shape the browser consumes, in its own naming convention.

        camelCase rather than snake_case because the consumer is a TypeScript
        manifest and translating at one boundary beats translating at every
        call site on the other side.
        """
        return {
            "name": self.name,
            "version": self.version,
            "displayName": self.title,
            "description": self.description,
            "octicon": self.octicon,
            "emoji": self.emoji,
            "dependencies": list(self.dependencies),
            "activationEvents": list(self.activation_events),
            "deactivationEvents": list(self.deactivation_events),
            "requiredBackendPlugins": list(self.required_backend_plugins),
            "optionalBackendPlugins": list(self.optional_backend_plugins),
            "export": self.export,
        }


@dataclass(frozen=True)
class FrontendExtension:
    """The JavaScript half of an extension: where it is, and what is in it."""

    #: Directory holding the built frontend, as shipped in the wheel.
    directory: Path
    #: The module within that directory the host imports.
    entry: str = "index.js"
    #: Refused by a host that speaks a different one, rather than loaded and
    #: crashed. The Python tier has had this on ``PluginCompatibility`` all
    #: along; a module fetched over the wire needs it at least as much.
    api_version: str = "v1"
    #: The manifests, without the code. See :class:`FrontendPlugin`.
    plugins: list[FrontendPlugin] = field(default_factory=list)
    #: How the host should load it.
    #:
    #: ``esm`` — a plain module, imported from its URL. ``federated`` — a
    #: Module Federation remote, which needs ``remote_name`` and ``module``.
    #: Both are described here so that migrating one extension to federation
    #: does not require every host to change at once.
    kind: str = "esm"
    remote_name: str = ""
    module: str = ""
    #: How a federated entry is built, in Module Federation's terms: ``global``
    #: (a script setting ``globalThis[remote_name]``, what bundlers emit and
    #: the runtime's default) or ``esm`` (a module exporting ``init`` and
    #: ``get``). Empty leaves the choice to the browser runtime. Only read
    #: when ``kind`` is ``federated``.
    remote_type: str = ""

    def resolve(self, relative: str) -> Path | None:
        """Resolve a request against this extension's directory, or refuse.

        The only defence between a URL path and the filesystem, so it is
        written to be read: resolve both sides and require the result to still
        be inside. ``..`` and absolute paths therefore go nowhere, and a
        symlink pointing out of the directory is caught by the same check
        because ``resolve()`` follows it.
        """
        root = self.directory.resolve()
        candidate = (root / relative).resolve()
        if candidate == root or root not in candidate.parents:
            return None
        if not candidate.is_file():
            return None
        return candidate


@dataclass(frozen=True)
class ReactorExtension:
    """One installable capability: its Python plugins and its JavaScript.

    What an entry point resolves to. Either half may be empty — a
    backend-only extension declares no ``frontend``, and a frontend-only one
    declares no ``plugins`` — but they are declared in one place, installed by
    one command, and versioned by one wheel.
    """

    manifest: ExtensionManifest
    #: ``(manifest, implementation)`` pairs, as ``register_extension`` takes.
    plugins: list[tuple[PluginManifest, Any]] = field(default_factory=list)
    frontend: FrontendExtension | None = None

    @property
    def name(self) -> str:
        return self.manifest.name
