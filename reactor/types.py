# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass(frozen=True)
class PluginCompatibility:
    api_version: str
    min_reactor_version: str = "0.1.0"
    max_reactor_version: str | None = None


@dataclass(frozen=True)
class PluginManifest:
    """What a plugin says about itself before anything runs it.

    `name` is the identifier other plugins depend on; `display_name`, together
    with `description`, `octicon` and `emoji`, is how a host shows it to a
    person. The same four presentation fields exist on the TypeScript
    `ReactorExtension`, deliberately: a host listing both tiers should not have
    to special-case which side a plugin came from.
    """

    name: str
    version: str
    description: str = ""
    author: str = ""
    #: Human-readable name. Hosts fall back to `name` when it is empty.
    display_name: str = ""
    #: Octicon id, e.g. "package", "plug", "beaker".
    octicon: str = ""
    #: A single emoji, for hosts with no icon set to draw from.
    emoji: str = ""
    tags: list[str] = field(default_factory=list)
    dependencies: list[str] = field(default_factory=list)
    #: Ids of the extension points this plugin *offers* to others.
    #:
    #: The registry knows who contributed to a point; it cannot know who opened
    #: it, because a point is only an id until something is put there.
    #: Declaring it here is what lets a host draw the other half — and show a
    #: point nobody has contributed to yet, which is when knowing it exists is
    #: most useful.
    extension_points: list[str] = field(default_factory=list)
    #: Frontend (TypeScript) extensions this plugin cannot be used without —
    #: by extension name, e.g. "@music/catalog".
    #:
    #: The platform cannot enforce this the way it enforces `dependencies`: the
    #: frontend runs in another process, and a backend that refused to start
    #: because a browser had not loaded something would be refusing for the
    #: wrong reason. So it is *declared* here and answered by whoever can see
    #: both sides — see `PluginPlatform.frontend_requirements`.
    frontend_dependencies: list[str] = field(default_factory=list)
    #: Frontend extensions this plugin does more with when they are there, and
    #: does without when they are not.
    optional_frontend_dependencies: list[str] = field(default_factory=list)
    tenant_scopes: list[str] = field(default_factory=lambda: ["*"])
    compatibility: PluginCompatibility = field(
        default_factory=lambda: PluginCompatibility(api_version="v1")
    )

    @property
    def title(self) -> str:
        """What to show a person: the display name, or the identifier."""
        return self.display_name or self.name


@dataclass
class PluginRecord:
    manifest: PluginManifest
    factory: Callable[..., Any]
    implementation: Any
    enabled: bool = True
    sandboxed: bool = False


@dataclass
class PluginEvent:
    name: str
    payload: dict[str, Any]
