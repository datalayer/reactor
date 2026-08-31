# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable

#: Activate as soon as the platform starts — the default when nothing is said.
ON_STARTUP = "onStartup"
#: Activate on anything at all, startup included.
ON_ANY = "*"


def on_contribution_point(point_id: str) -> str:
    """The event fired when somebody reads a contribution point."""
    return f"onContributionPoint:{point_id}"


def on_command(command_id: str) -> str:
    """The event an application fires when it runs a command. A convention."""
    return f"onCommand:{command_id}"


def matches_activation(declared: list[str] | None, event: str) -> bool:
    """Whether a plugin declaring these events should activate on this one.

    Nothing declared means startup, so a plugin with no opinion behaves as it
    did before activation events existed. ``"*"`` matches everything. Anything
    else matches exactly — prefix matching would make ``onView:note`` fire on
    ``onView:notebook``, a bug that only surfaces in someone else's host.
    """
    if not declared:
        return event == ON_STARTUP
    return any(candidate in (ON_ANY, event) for candidate in declared)


def matches_deactivation(declared: list[str] | None, event: str) -> bool:
    """Whether a plugin declaring these deactivation events should stand down.

    The asymmetry with :func:`matches_activation` is deliberate and is the
    whole difference between the two: an empty activation list means "at
    startup", because a plugin with no opinion should run; an empty
    *deactivation* list means **never**, because a plugin with no opinion
    should stay running. Point both defaults the same way and every plugin
    that said nothing is torn down by the first event anyone fires.
    """
    if not declared:
        return False
    return any(candidate in (ON_ANY, event) for candidate in declared)


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
    `ReactorPlugin`, deliberately: a host listing both tiers should not have
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
    #: The extension that groups this plugin, when one delivered it.
    #:
    #: Set by :meth:`PluginPlatform.register_extension`; a plugin registered on
    #: its own leaves it empty. Grouping is a fact about where a plugin came
    #: from, never about what it may do.
    extension: str = ""
    #: What has to happen before this plugin is activated.
    #:
    #: Empty means "at startup", which is what a plugin without an opinion
    #: wants. Declared, the platform holds the plugin — unregistered with
    #: pluggy, contributing nothing — until one of the events fires. The
    #: manifest is readable the whole time, so a held plugin is still listed,
    #: described and drawn on the graph.
    activation_events: list[str] = field(default_factory=list)
    #: What makes this plugin stand down again. Empty means nothing does.
    #:
    #: Deactivating is not disabling. Disabling is a person's decision and it
    #: sticks — no event revives a disabled plugin. This says only that the
    #: reason for running has passed: the plugin keeps its place in the list
    #: and its implementation, and is eligible to activate again.
    deactivation_events: list[str] = field(default_factory=list)
    #: Ids of the contribution points this plugin *offers* to others.
    #:
    #: The registry knows who contributed to a point; it cannot know who opened
    #: it, because a point is only an id until something is put there.
    #: Declaring it here is what lets a host draw the other half — and show a
    #: point nobody has contributed to yet, which is when knowing it exists is
    #: most useful.
    contribution_points: list[str] = field(default_factory=list)
    #: Frontend (TypeScript) plugins this plugin cannot be used without —
    #: by plugin name, e.g. "@music/catalog".
    #:
    #: The platform cannot enforce this the way it enforces `dependencies`: the
    #: frontend runs in another process, and a backend that refused to start
    #: because a browser had not loaded something would be refusing for the
    #: wrong reason. So it is *declared* here and answered by whoever can see
    #: both sides — see `PluginPlatform.frontend_requirements`.
    frontend_dependencies: list[str] = field(default_factory=list)
    #: Frontend plugins this plugin does more with when they are there, and
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
    #: Whether the plugin has been activated — registered and its contributions
    #: collected. Distinct from ``enabled``: a plugin can be enabled and still
    #: waiting for the event it declared.
    activated: bool = True
    #: Why it is switched off: ``"user"`` or ``"dependency"``, empty when it is
    #: not. A person's decision sticks; a plugin taken down with something it
    #: depends on comes back when that does. Collapsing the two would let
    #: enabling a dependency silently override somebody's switch.
    disabled_by: str = ""


@dataclass(frozen=True)
class ExtensionManifest:
    """A group of related plugins, installed as one thing.

    The unit of function is the plugin; the unit of delivery is the extension.
    A notebook capability is an editor, a toolbar and a set of commands, and
    nobody wants to install three things to get one — or to read a plugin list
    where those three sit at the same level as everything else.

    Deliberately thin: a name, a presentation, and members. It has no lifecycle,
    contributes nothing, and cannot be enabled or disabled. Registering one
    registers its plugins, and from that moment the platform deals only in
    plugins. Mirrors the TypeScript ``ReactorExtension`` for the same reason
    the manifests mirror each other.
    """

    name: str
    version: str = ""
    display_name: str = ""
    description: str = ""
    octicon: str = ""
    emoji: str = ""

    @property
    def title(self) -> str:
        """What to show a person: the display name, or the identifier."""
        return self.display_name or self.name


@dataclass
class PluginEvent:
    name: str
    payload: dict[str, Any]
