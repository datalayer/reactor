# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

from __future__ import annotations

import logging
from collections import defaultdict
from dataclasses import asdict, replace
from typing import Any, Callable, Iterable

import pluggy

from .contributions import (
    Contribution,
    ContributionRegistry,
    ContributionPoint,
    PluginContributions,
)
from .commands import (
    Command,
    CommandRegistry,
    PluginCommands,
)
from .extensions import (
    EXTENSION_ENTRY_POINT_GROUP,
    FrontendExtension,
    ReactorExtension,
)
from .hooks import ReactorHookSpecs
from .marketplace import MarketplaceEntry, PluginMarketplace
from .sandbox import SandboxExecutor
from .types import (
    ON_STARTUP,
    ExtensionManifest,
    PluginManifest,
    PluginRecord,
    matches_activation,
    matches_deactivation,
    on_contribution_point,
)

logger = logging.getLogger(__name__)


class PluginPlatform:
    """Platform-grade plugin runtime with marketplace and tenant-aware lifecycle."""

    PLATFORM_VERSION = "0.1.0"

    def __init__(self, *, extension_group: str = EXTENSION_ENTRY_POINT_GROUP):
        #: The entry-point group this platform discovers extensions from.
        #:
        #: Configurable rather than fixed for two reasons that turn out to be
        #: the same one: a host may want its own namespace, and a *test* must
        #: have one — a suite that scanned the default group would pass or fail
        #: depending on what happened to be installed in the environment
        #: running it, which is not a test.
        self.extension_group = extension_group
        self._pm = pluggy.PluginManager("reactor")
        self._pm.add_hookspecs(ReactorHookSpecs)
        self._records: dict[str, PluginRecord] = {}
        self._tenant_plugins: dict[str, set[str]] = defaultdict(set)
        self._marketplace = PluginMarketplace()
        self._sandbox = SandboxExecutor()
        self._contributions = ContributionRegistry()
        self._commands = CommandRegistry()
        self._extensions: dict[str, ExtensionManifest] = {}
        #: Points already read, so a point's activation event fires once.
        self._fired_points: set[str] = set()
        #: Discovered extensions' frontend halves, by extension name.
        self._frontend: dict[str, FrontendExtension] = {}
        #: Which plugins each discovered extension brought, so an uninstall
        #: can take exactly those away again.
        self._discovered: dict[str, list[str]] = {}
        #: Entry points that failed to load, and the error they failed with.
        #:
        #: Kept for log de-duplication, *not* to stop retrying. An extension
        #: that failed a moment ago is very often one that was installed a
        #: moment ago — the entry point is written before the module is
        #: importable — so refusing to try again would make the common case the
        #: broken one.
        self._failed: dict[str, str] = {}
        #: Whether :meth:`start` has run, so a plugin discovered afterwards is
        #: started too rather than sitting registered and never woken.
        self._started = False
        #: Bumped whenever what this platform would answer changes.
        #:
        #: A counter rather than a callback fan-out, because the consumer is on
        #: the other side of an HTTP connection: a browser that has seen
        #: revision 7 needs one integer to know whether to ask again. It is what
        #: ``GET /events/stream`` watches, and what makes polling a correct
        #: fallback rather than a different mechanism.
        self._revision = 0

    @property
    def revision(self) -> int:
        """How many times what this platform answers has changed."""
        return self._revision

    def _bump(self) -> None:
        self._revision += 1

    @property
    def marketplace(self) -> PluginMarketplace:
        return self._marketplace

    def publish(self, manifest: PluginManifest, source: str) -> None:
        self._marketplace.publish(MarketplaceEntry(manifest=manifest, source=source))

    def register_plugin(
        self,
        manifest: PluginManifest,
        plugin_impl: Any = None,
        *,
        factory: Callable[[], Any] | None = None,
        sandboxed: bool = False,
        auto_enable: bool = True,
    ) -> None:
        """Register a plugin, activating it unless it asked to wait.

        ``plugin_impl`` is the implementation; ``factory`` builds it on
        activation instead, which is what makes a deferred plugin worth
        deferring — the object is not constructed until its event fires.
        A plugin that declares no activation events activates immediately,
        exactly as before.
        """
        if plugin_impl is None and factory is None:
            raise ValueError(
                f"{manifest.name} needs either an implementation or a factory"
            )
        self._assert_compatible(manifest)
        self._assert_dependencies(manifest)

        record = PluginRecord(
            manifest=manifest,
            factory=factory or (lambda: plugin_impl),
            implementation=plugin_impl,
            enabled=auto_enable,
            sandboxed=sandboxed,
            activated=False,
        )
        self._records[manifest.name] = record
        self._bump()

        for tenant_scope in manifest.tenant_scopes:
            if tenant_scope == "*":
                continue
            self._tenant_plugins[tenant_scope].add(manifest.name)

        if matches_activation(manifest.activation_events, ON_STARTUP):
            self.activate_plugin(manifest.name)

    def register_extension(
        self,
        extension: ExtensionManifest,
        plugins: Iterable[tuple[PluginManifest, Any]],
        **kwargs: Any,
    ) -> list[str]:
        """Register every plugin an extension delivers.

        The extension is remembered for presentation and stamped onto each
        member's manifest; it is not itself registered, has no lifecycle, and
        cannot be enabled or disabled. See :class:`ExtensionManifest`.

        Returns the names registered, in declaration order.
        """
        self._extensions[extension.name] = extension
        registered: list[str] = []
        for manifest, implementation in plugins:
            grouped = replace(manifest, extension=extension.name)
            self.register_plugin(grouped, implementation, **kwargs)
            registered.append(grouped.name)
        return registered

    def list_extensions(self) -> list[dict[str, Any]]:
        """Every extension, its presentation, and the plugins it delivered."""
        return [
            {
                "name": extension.name,
                "version": extension.version,
                "display_name": extension.title,
                "description": extension.description,
                "octicon": extension.octicon,
                "emoji": extension.emoji,
                "plugins": [
                    name
                    for name, record in self._records.items()
                    if record.manifest.extension == extension.name
                ],
            }
            for extension in self._extensions.values()
        ]

    def activate_plugin(self, name: str) -> bool:
        """Activate one plugin, and whatever it depends on, first.

        A plugin woken by an event may depend on one still waiting for an event
        of its own; collecting contributions against a dependency that has not
        registered would be the same bug as activating out of dependency order
        at startup. So dependencies are activated on demand here, whatever they
        were waiting for.

        Returns whether this call activated it — ``False`` if it already was.
        """
        record = self._get_record(name)
        if record.activated:
            return False
        # Marked before the recursion, so a dependency cycle stops rather than
        # recursing until the interpreter gives up.
        record.activated = True
        self._bump()
        for dependency in record.manifest.dependencies:
            if dependency in self._records:
                self.activate_plugin(dependency)
        if record.implementation is None:
            record.implementation = record.factory()
        self._pm.register(record.implementation, name=name)
        self._collect_contributions(name, record)
        self._collect_commands(name, record)
        return True

    def deactivate_plugin(self, name: str) -> list[str]:
        """Stand a plugin down, dependants first, and say what went.

        Its contributions go and it is unregistered from pluggy; its manifest,
        its place in the list and its implementation stay, and it is eligible
        to activate again the next time one of its activation events fires.

        Not the same as :meth:`disable_plugin`. Disabling is a person's
        decision and it sticks; this says only that the reason for running has
        passed. Anything that depends on it is stood down first — a dependant
        left running against a deactivated dependency is holding contributions
        nobody maintains.
        """
        record = self._get_record(name)
        if not record.activated:
            return []

        stood_down: list[str] = []
        for dependant in self._dependants_of(name):
            dependant_record = self._records[dependant]
            if not dependant_record.activated:
                continue
            self._retire(dependant, dependant_record)
            stood_down.append(dependant)
        self._retire(name, record)
        stood_down.append(name)
        return stood_down

    def _retire(self, name: str, record: PluginRecord) -> None:
        """Drop one plugin's contributions and commands, and unregister it."""
        self._contributions.dispose_plugin(name)
        self._commands.dispose_plugin(name)
        try:
            self._pm.unregister(record.implementation)
        except Exception as error:  # noqa: BLE001
            logger.warning(
                "Plugin %s could not be unregistered from pluggy: %s", name, error
            )
        record.activated = False
        self._bump()
        # The points it waits on may fire again. A point fires its activation
        # event once so a plugin is not re-activated on every read; that guard
        # has to be lifted for the plugin standing down, and for nobody else.
        for event in record.manifest.activation_events:
            if event.startswith("onContributionPoint:"):
                self._fired_points.discard(event.split(":", 1)[1])

    def _dependants_of(self, name: str) -> list[str]:
        """Everything depending on this plugin, transitively, deepest first."""
        wanted = {name}
        changed = True
        # Registration order is not dependency order — a plugin may be
        # registered before something that depends on it — so this repeats
        # until it settles rather than assuming one pass is enough.
        while changed:
            changed = False
            for candidate, record in self._records.items():
                if candidate in wanted:
                    continue
                if any(dep in wanted for dep in record.manifest.dependencies):
                    wanted.add(candidate)
                    changed = True
        wanted.discard(name)
        # Deepest first: nothing is torn down while something holding its
        # contributions is still up.
        return sorted(wanted, key=self._dependency_depth, reverse=True)

    def _dependency_depth(self, name: str, seen: frozenset[str] = frozenset()) -> int:
        """How far this plugin sits above the things it depends on."""
        if name in seen or name not in self._records:
            return 0
        seen = seen | {name}
        return (
            max(
                (
                    self._dependency_depth(dep, seen)
                    for dep in self._records[name].manifest.dependencies
                    if dep in self._records
                ),
                default=-1,
            )
            + 1
        )

    def fire_event(self, event: str) -> dict[str, list[str]]:
        """Fire an event: stand down what was waiting to, then wake what was.

        Deactivation runs first, so one event can retire the old thing and
        bring up the new — the other order leaves both running for a moment,
        which a caller reading a point in between would see.

        Firing an event nobody waits on is free and does nothing, which is what
        lets a host fire liberally — on every view change, say — rather than
        checking first.
        """
        stood_down: list[str] = []
        for name, record in list(self._records.items()):
            if not record.activated:
                continue
            if matches_deactivation(record.manifest.deactivation_events, event):
                stood_down.extend(self.deactivate_plugin(name))

        woken: list[str] = []
        for name, record in list(self._records.items()):
            if record.activated:
                continue
            if matches_activation(record.manifest.activation_events, event):
                if self.activate_plugin(name):
                    woken.append(name)
        return {"deactivated": stood_down, "activated": woken}

    def unregister_plugin(self, name: str) -> None:
        """Remove a plugin and everything it contributed.

        Disabling is reversible and keeps contributions in place; unregistering
        is not, so what the plugin offered goes with it.
        """
        # The lookup first, and the bump after it: `_get_record` raises for a
        # name that is not here, and bumping before that would tell every SSE
        # client something changed because somebody asked about a plugin that
        # does not exist.
        record = self._get_record(name)
        self._bump()
        self._contributions.dispose_plugin(name)
        self._commands.dispose_plugin(name)
        try:
            if record.activated:
                self._pm.unregister(record.implementation)
        except Exception as error:  # noqa: BLE001
            logger.warning(
                "Plugin %s could not be unregistered from pluggy: %s", name, error
            )
        for plugins in self._tenant_plugins.values():
            plugins.discard(name)
        del self._records[name]

    def get_contributions(
        self,
        point: ContributionPoint[Any],
        tenant_id: str | None = None,
    ) -> list[Contribution[Any]]:
        """What enabled plugins have contributed to a point.

        Disabled plugins are filtered out here rather than at each call site,
        and so is anything outside the tenant's scope when one is given: a
        contribution a tenant may not use should not be a contribution a tenant
        can see.

        Reading a point is itself an activation event: a plugin that only
        matters once somebody looks here activates exactly now, and whoever
        looked never had to know it existed. Unlike the TypeScript side, where
        a module may still be on the wire, activation here is synchronous — so
        the plugins it wakes are in the list this call returns.
        """
        if point.id not in self._fired_points:
            self._fired_points.add(point.id)
            self.fire_event(on_contribution_point(point.id))
        if tenant_id is not None:
            allowed: set[str] = set(self.resolve_tenant_plugins(tenant_id))
        else:
            allowed = {
                plugin_name
                for plugin_name, record in self._records.items()
                if record.enabled
            }
        return self._contributions.get(point, plugins=allowed)

    def contributions_for(self, plugin_name: str) -> PluginContributions:
        """The registry as one plugin sees it, for contributing after startup."""
        self._get_record(plugin_name)
        return PluginContributions(self._contributions, plugin_name)

    def _collect_commands(self, plugin_name: str, record: PluginRecord) -> None:
        """Let a freshly registered plugin register its commands.

        A plugin that fails here is registered anyway, without its commands:
        one bad plugin must not take down the host, the same posture as
        `register_cli` and `_collect_contributions`.
        """
        provider = getattr(record.implementation, "provide_slash_commands", None)
        if not callable(provider):
            return
        view = PluginCommands(self._commands, plugin_name)
        try:
            self._run_plugin_call(plugin_name, lambda: provider(view))
        except Exception as error:  # noqa: BLE001
            logger.warning(
                "Plugin %s failed to register commands: %s",
                plugin_name,
                error,
                exc_info=True,
            )

    def commands_for(self, plugin_name: str) -> PluginCommands:
        """The command registry as one plugin sees it, for a host that wants
        to register on a plugin's behalf rather than through the hook."""
        return PluginCommands(self._commands, plugin_name)

    def list_commands(self, tenant_id: str | None = None) -> list[Command]:
        """Every command registered by an enabled plugin.

        Read through the tenant filter for the same reason contributions are:
        what a tenant may invoke is decided where enablement already lives, not
        by each caller remembering to check.
        """
        allowed = self._enabled_plugin_names(tenant_id)
        return [
            command
            for command in self._commands.list()
            if self._commands.owner(command.id) in allowed
        ]

    def describe_commands(self, tenant_id: str | None = None) -> list[dict]:
        """Every command as JSON, for a host serving a palette over HTTP."""
        allowed = self._enabled_plugin_names(tenant_id)
        return [entry for entry in self._commands.describe() if entry["plugin"] in allowed]

    async def execute_command(
        self,
        command_id: str,
        argument: object = None,
        tenant_id: str | None = None,
    ) -> object:
        """Run a command by id, honouring enablement and the tenant filter."""
        allowed = self._enabled_plugin_names(tenant_id)
        owner = self._commands.owner(command_id)
        if owner is None:
            raise KeyError(f"No command '{command_id}' is registered")
        if owner not in allowed:
            # Indistinguishable from "no such command" on purpose: a tenant
            # that may not use a plugin should not learn what it offers.
            raise KeyError(f"No command '{command_id}' is registered")
        return await self._commands.execute(command_id, argument)

    def _enabled_plugin_names(self, tenant_id: str | None) -> set[str]:
        """Plugins whose commands count right now."""
        names = {name for name, record in self._records.items() if record.enabled}
        if tenant_id:
            names &= set(self.resolve_tenant_plugins(tenant_id))
        return names

    def _collect_contributions(self, plugin_name: str, record: PluginRecord) -> None:
        """Let a freshly registered plugin declare what it offers.

        A plugin that fails here is registered anyway, without its
        contributions: one bad plugin must not take down the host, the same
        posture as `register_cli`.
        """
        provider = getattr(record.implementation, "provide_contributions", None)
        if not callable(provider):
            return
        view = PluginContributions(self._contributions, plugin_name)
        try:
            self._run_plugin_call(plugin_name, lambda: provider(view))
        except Exception as error:  # noqa: BLE001
            import logging

            logging.getLogger(__name__).warning(
                "Plugin %s failed to contribute: %s", plugin_name, error, exc_info=True
            )

    def list_plugins(self) -> list[dict[str, Any]]:
        """Every plugin's manifest, plus the state the manifest cannot carry.

        ``activated`` is reported beside ``enabled`` because they are different
        questions and a host that conflates them will draw a held plugin as a
        broken one.
        """
        return [
            {
                **asdict(record.manifest),
                "enabled": record.enabled,
                "activated": record.activated,
                "sandboxed": record.sandboxed,
                # Empty when it is on. A host drawing a switch needs to tell a
                # plugin somebody turned off from one that went with its
                # dependency — they are not the same fact.
                "disabled_by": record.disabled_by,
            }
            for record in self._records.values()
        ]

    def describe_contributions(
        self,
        tenant_id: str | None = None,
    ) -> list[dict[str, Any]]:
        """Every point that holds something, and what each holds.

        For hosts that describe the whole graph rather than read one point:
        they have no `ContributionPoint` objects to look things up with, only ids.
        Disabled plugins are filtered out the same way `get_contributions`
        filters them, so the description matches what is actually live.
        """
        if tenant_id is not None:
            allowed: set[str] = set(self.resolve_tenant_plugins(tenant_id))
        else:
            allowed = {
                plugin_name
                for plugin_name, record in self._records.items()
                if record.enabled
            }
        described: list[dict[str, Any]] = []
        for point_id in self._contributions.points():
            entries = [
                {"plugin": entry.plugin, "id": entry.id, "order": entry.order}
                for entry in self._contributions.get(
                    ContributionPoint(id=point_id), plugins=allowed
                )
            ]
            if entries:
                described.append({"point": point_id, "contributions": entries})
        return described

    def frontend_requirements(
        self,
        active_frontend: Iterable[str] | None = None,
    ) -> dict[str, dict[str, list[str]]]:
        """What each enabled plugin asks of the frontend, and what is missing.

        A backend plugin can declare the frontend plugins it needs
        (`frontend_dependencies`) and the ones it merely benefits from
        (`optional_frontend_dependencies`). The platform cannot check either on
        its own — the plugins live in a browser — so it answers here for a
        caller that *can* see both sides, typically the frontend itself asking
        "is anything the server needs missing from what I loaded?".

        Passing no `active_frontend` reports the declarations with everything
        counted as missing, which is the honest answer when the caller does not
        know what the frontend has.
        """
        active = set(active_frontend or ())
        out: dict[str, dict[str, list[str]]] = {}
        for plugin_name, record in self._records.items():
            if not record.enabled:
                continue
            required = list(record.manifest.frontend_dependencies)
            optional = list(record.manifest.optional_frontend_dependencies)
            if not required and not optional:
                continue
            out[plugin_name] = {
                "required": required,
                "optional": optional,
                "missing_required": [n for n in required if n not in active],
                "missing_optional": [n for n in optional if n not in active],
            }
        return out

    def enable_plugin(self, name: str) -> list[str]:
        """Switch a plugin on, and bring back what its disabling took down.

        Only what *this* plugin's disabling took down: a dependant somebody
        switched off by hand stays off, because a person's decision should not
        be undone by an unrelated switch three plugins away.

        Returns every plugin this enabled, dependencies first.
        """
        record = self._get_record(name)
        if record.enabled:
            return []
        record.enabled = True
        record.disabled_by = ""
        self._bump()
        enabled = [name]

        # `_dependants_of` is deepest-first, for tearing down. Reversed here:
        # a dependency has to be running again before what needs it starts.
        for dependant in reversed(self._dependants_of(name)):
            candidate = self._records[dependant]
            if candidate.enabled or candidate.disabled_by != "dependency":
                continue
            if not self._dependencies_enabled(dependant):
                continue
            candidate.enabled = True
            candidate.disabled_by = ""
            enabled.append(dependant)
        return enabled

    def disable_plugin(self, name: str) -> list[str]:
        """Switch a plugin off, dependants first, and say what went.

        A dependant left enabled against a disabled dependency is answering for
        an output nobody maintains. Its contributions are still filtered out on
        read, so nothing here is destructive — see
        :meth:`get_contributions`.

        Returns every plugin this disabled, dependants first.
        """
        record = self._get_record(name)
        if not record.enabled:
            return []

        disabled: list[str] = []
        for dependant in self._dependants_of(name):
            candidate = self._records[dependant]
            if not candidate.enabled:
                continue
            candidate.enabled = False
            candidate.disabled_by = "dependency"
            disabled.append(dependant)

        record.enabled = False
        record.disabled_by = "user"
        self._bump()
        disabled.append(name)
        return disabled

    def _dependencies_enabled(self, name: str) -> bool:
        """Whether everything this plugin depends on is switched on."""
        manifest = self._records[name].manifest
        return all(
            self._records[dependency].enabled
            for dependency in manifest.dependencies
            if dependency in self._records
        )

    def enable_plugin_for_tenant(self, name: str, tenant_id: str) -> None:
        self._get_record(name)
        self._tenant_plugins[tenant_id].add(name)

    def disable_plugin_for_tenant(self, name: str, tenant_id: str) -> None:
        self._tenant_plugins[tenant_id].discard(name)

    def resolve_tenant_plugins(self, tenant_id: str) -> list[str]:
        names: list[str] = []
        for plugin_name, record in self._records.items():
            if not record.enabled:
                continue
            scopes = set(record.manifest.tenant_scopes)
            if "*" in scopes or tenant_id in scopes or plugin_name in self._tenant_plugins[tenant_id]:
                names.append(plugin_name)
        return names

    def start(self, tenant_id: str | None = None) -> None:
        self._started = True
        self._invoke_enabled_hook("on_reactor_start", tenant_id=tenant_id)

    def stop(self, tenant_id: str | None = None) -> None:
        self._started = False
        self._invoke_enabled_hook("on_reactor_stop", tenant_id=tenant_id)
        self._sandbox.shutdown()

    def register_cli(self, cli: Any, tenant_id: str | None = None) -> list[str]:
        """Ask every enabled plugin to add its commands to the host CLI.

        Returns the names of the plugins whose ``provide_cli`` ran
        successfully. A plugin that fails to register is skipped, never
        fatal: one broken plugin must not take the whole command line
        down.
        """
        active = set(self.resolve_tenant_plugins(tenant_id or "*")) if tenant_id else None
        registered: list[str] = []
        for plugin_name, record in self._records.items():
            if not record.enabled:
                continue
            if active is not None and plugin_name not in active:
                continue
            provider = getattr(record.implementation, "provide_cli", None)
            if not callable(provider):
                continue
            try:
                # Positionally: the plugin names its own parameter — `cli`,
                # `app` — and a keyword here would dictate the name.
                self._run_plugin_call(plugin_name, lambda: provider(cli))
                registered.append(plugin_name)
            except Exception as error:  # noqa: BLE001
                import logging

                logging.getLogger(__name__).warning(
                    "Plugin %s failed to register its CLI commands: %s",
                    plugin_name,
                    error,
                    exc_info=True,
                )
        return registered

    def discover(self, group: str) -> list[str]:
        """Register every plugin advertised under an entry-point group.

        An extension declares itself in its own distribution::

            [project.entry-points."datalayer.cli"]
            agent-runtimes = "agent_runtimes.reactor_extension:plugin"

        The entry point resolves to a callable returning
        ``(PluginManifest, plugin_implementation)``. Installing the
        distribution is publishing the plugin; nothing is hardcoded on the
        host side. A distribution that fails to load is skipped, with a
        warning — the host CLI must come up whatever is installed next to it.
        """
        from importlib.metadata import entry_points

        registered: list[str] = []
        for entry_point in entry_points(group=group):
            try:
                factory = entry_point.load()
                manifest, implementation = factory()
                self.register_plugin(manifest, implementation)
                registered.append(manifest.name)
            except Exception as error:  # noqa: BLE001
                import logging

                logging.getLogger(__name__).warning(
                    "Extension %r of group %r could not be loaded: %s",
                    entry_point.name,
                    group,
                    error,
                    exc_info=True,
                )
        return registered

    # ------------------------------------------------------------------
    # Extensions that ship both tiers
    # ------------------------------------------------------------------

    def discover_extensions(self, group: str | None = None) -> list[str]:
        """Register every extension advertised under an entry-point group.

        Installing a distribution is publishing its extension; the host names
        nothing. Returns the extension names registered by *this* call, so a
        caller can tell what is new from what was already there.
        """
        return self.rescan_extensions(group)["added"]

    def rescan_extensions(self, group: str | None = None) -> dict[str, list[str]]:
        """Bring the registry in line with what is installed *right now*.

        Idempotent, and cheap enough to call per request — which is the point.
        A server that only scanned at startup would need restarting to see a
        newly installed extension, and "restart the server" is not an answer
        for a platform whose whole subject is adding things at runtime. The
        browser triggers this on refresh, and the refresh *is* the reload.

        Three things have to be defeated for that to work, and all three are
        the same cache:

        * ``importlib.metadata`` remembers the distributions it found;
        * ``FileFinder`` remembers the directory listing of ``site-packages``,
          so a package installed a moment ago will not even import;
        * both are cleared by :func:`importlib.invalidate_caches`.

        Returns ``{"added": [...], "removed": [...]}``, by extension name.
        """
        import importlib
        from importlib.metadata import entry_points

        group = group or self.extension_group

        # Without this, a distribution installed after this process started is
        # invisible — the listing it would be found in was cached the first
        # time anybody looked.
        importlib.invalidate_caches()

        found: dict[str, Any] = {}
        for entry_point in entry_points(group=group):
            found[entry_point.name] = entry_point

        added: list[str] = []
        for entry_name, entry_point in found.items():
            if entry_name in self._discovered:
                continue
            try:
                extension = entry_point.load()()
                self._register_extension_object(entry_name, extension)
                added.append(extension.name)
                self._failed.pop(entry_name, None)
            except Exception as error:  # noqa: BLE001
                # One broken extension is one missing extension. A host that
                # refused to answer because something installed next to it was
                # malformed would be punishing the wrong party.
                #
                # Retried on the next scan rather than remembered as hopeless:
                # the most common failure here is an extension whose entry point
                # is already advertised while its module is not yet importable,
                # which fixes itself moments later. The error text is kept only
                # so the log says it once rather than once per request.
                reported = f"{type(error).__name__}: {error}"
                if self._failed.get(entry_name) != reported:
                    self._failed[entry_name] = reported
                    logger.warning(
                        "Extension %r of group %r could not be loaded: %s",
                        entry_name,
                        group,
                        error,
                        exc_info=True,
                    )

        removed: list[str] = []
        for entry_name in list(self._discovered):
            if entry_name in found:
                continue
            removed.extend(self._forget_extension(entry_name))
        for entry_name in list(self._failed):
            if entry_name not in found:
                self._failed.pop(entry_name, None)

        return {"added": added, "removed": removed}

    def _register_extension_object(
        self, entry_name: str, extension: ReactorExtension
    ) -> None:
        """Register both halves of one discovered extension."""
        registered = self.register_extension(extension.manifest, extension.plugins)
        self._discovered[entry_name] = registered
        if extension.frontend is not None:
            self._frontend[extension.name] = extension.frontend
        # A plugin discovered after `start()` has missed the hook every other
        # plugin got. Give it to this one, and to nobody else — re-running the
        # hook for the whole platform would start everything a second time.
        if self._started and registered:
            self._start_late(registered)

    def _start_late(self, names: list[str]) -> None:
        """Fire ``on_reactor_start`` for these plugins only.

        pluggy calls every registered implementation of a hook, so the way to
        notify a subset is to build a caller with the others removed.
        """
        already_running = [
            record.implementation
            for name, record in self._records.items()
            if name not in names and record.implementation is not None
        ]
        try:
            caller = self._pm.subset_hook_caller(
                "on_reactor_start", remove_plugins=already_running
            )
            caller(tenant_id=None)
        except Exception as error:  # noqa: BLE001
            logger.warning(
                "Late-registered plugins %s could not be started: %s", names, error
            )

    def _forget_extension(self, entry_name: str) -> list[str]:
        """Drop an extension that is no longer installed, and say what went.

        The Python modules it imported stay imported — one process cannot
        unimport, and pretending otherwise would be worse than saying so. What
        does go is everything the platform was answering *about* it: its
        plugins, its contributions, its place in the extension list, and its
        frontend.
        """
        names = self._discovered.pop(entry_name, [])
        gone: list[str] = []
        for plugin_name in names:
            if plugin_name in self._records:
                extension_name = self._records[plugin_name].manifest.extension
                self.unregister_plugin(plugin_name)
                gone.append(plugin_name)
                self._extensions.pop(extension_name, None)
                self._frontend.pop(extension_name, None)
        return gone

    def frontend_extensions(
        self, base_url: str = "/reactor-extensions"
    ) -> list[dict[str, Any]]:
        """What a browser needs to list, describe and load every frontend half.

        Every plugin's manifest is in here, which is the whole point: the shell
        can paint a complete plugin list — names, descriptions, icons,
        switches — before a single byte of any extension's JavaScript has been
        fetched.
        """
        answer: list[dict[str, Any]] = []
        for name, frontend in self._frontend.items():
            manifest = self._extensions.get(name)
            answer.append(
                {
                    "name": name,
                    "version": manifest.version if manifest else "",
                    "displayName": manifest.title if manifest else name,
                    "description": manifest.description if manifest else "",
                    "octicon": manifest.octicon if manifest else "",
                    "emoji": manifest.emoji if manifest else "",
                    "apiVersion": frontend.api_version,
                    "kind": frontend.kind,
                    "remoteName": frontend.remote_name,
                    "module": frontend.module,
                    "remoteType": frontend.remote_type,
                    "entry": f"{base_url}/{name}/{frontend.entry}",
                    "plugins": [plugin.to_dict() for plugin in frontend.plugins],
                    # What this extension's Python half brought, so a host can
                    # draw the two together rather than as unrelated lists.
                    "backendPlugins": self._discovered_plugins_of(name),
                }
            )
        return answer

    def _discovered_plugins_of(self, extension_name: str) -> list[str]:
        return [
            plugin_name
            for plugin_name, record in self._records.items()
            if record.manifest.extension == extension_name
        ]

    def frontend_extension(self, name: str) -> FrontendExtension | None:
        """One extension's frontend half, or ``None`` if it has none."""
        return self._frontend.get(name)

    def collect_routes(self, tenant_id: str | None = None) -> list[dict[str, Any]]:
        active = set(self.resolve_tenant_plugins(tenant_id or "*")) if tenant_id else None
        routes: list[dict[str, Any]] = []
        for plugin_name, record in self._records.items():
            if not record.enabled:
                continue
            if active is not None and plugin_name not in active:
                continue
            provider = getattr(record.implementation, "provide_routes", None)
            if callable(provider):
                plugin_routes = self._run_plugin_call(plugin_name, provider)
                routes.extend(plugin_routes or [])
        return routes

    def feature_flags(self, tenant_id: str) -> dict[str, bool]:
        flags: dict[str, bool] = {}
        active = set(self.resolve_tenant_plugins(tenant_id))
        for plugin_name in active:
            record = self._records[plugin_name]
            provider = getattr(record.implementation, "feature_flags", None)
            if callable(provider):
                plugin_flags = self._run_plugin_call(plugin_name, lambda: provider(tenant_id=tenant_id))
                flags.update(plugin_flags or {})
            if record.manifest.name not in flags:
                flags[record.manifest.name] = True
        return flags

    def invoke_plugin_action(
        self,
        plugin_name: str,
        action: str,
        payload: dict[str, Any] | None = None,
        tenant_id: str | None = None,
    ) -> dict[str, Any]:
        record = self._get_record(plugin_name)
        if not record.enabled:
            raise ValueError(f"Plugin {plugin_name} is disabled")

        handler = getattr(record.implementation, "invoke_action", None)
        if not callable(handler):
            raise ValueError(f"Plugin {plugin_name} does not expose invoke_action")

        result = self._run_plugin_call(
            plugin_name,
            lambda: handler(action=action, payload=payload or {}, tenant_id=tenant_id),
        )

        if isinstance(result, dict):
            return result
        return {"result": result}

    def _invoke_enabled_hook(self, hook_name: str, **kwargs: Any) -> None:
        hook = getattr(self._pm.hook, hook_name)
        for plugin_name, record in self._records.items():
            if not record.enabled:
                continue
            self._run_plugin_call(plugin_name, lambda: hook(**kwargs))

    def _run_plugin_call(self, plugin_name: str, call: Any) -> Any:
        record = self._records[plugin_name]
        if record.sandboxed:
            return self._sandbox.run(call)
        return call()

    def _assert_compatible(self, manifest: PluginManifest) -> None:
        compat = manifest.compatibility
        current = self._version_tuple(self.PLATFORM_VERSION)
        min_required = self._version_tuple(compat.min_reactor_version)
        if min_required > current:
            raise ValueError(
                f"Plugin {manifest.name} requires reactor >= {compat.min_reactor_version}"
            )
        if compat.max_reactor_version:
            max_supported = self._version_tuple(compat.max_reactor_version)
            if max_supported < current:
                raise ValueError(
                    f"Plugin {manifest.name} supports reactor <= {compat.max_reactor_version}"
                )

    @staticmethod
    def _version_tuple(version: str) -> tuple[int, int, int]:
        parts = [int(part) for part in version.split(".")[:3]]
        while len(parts) < 3:
            parts.append(0)
        return parts[0], parts[1], parts[2]

    def _assert_dependencies(self, manifest: PluginManifest) -> None:
        missing = [dep for dep in manifest.dependencies if dep not in self._records]
        if missing:
            raise ValueError(f"Plugin {manifest.name} has missing dependencies: {', '.join(missing)}")

    def _get_record(self, name: str) -> PluginRecord:
        record = self._records.get(name)
        if not record:
            raise KeyError(f"Unknown plugin {name}")
        return record
