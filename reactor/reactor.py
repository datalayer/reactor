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

    def __init__(self):
        self._pm = pluggy.PluginManager("reactor")
        self._pm.add_hookspecs(ReactorHookSpecs)
        self._records: dict[str, PluginRecord] = {}
        self._tenant_plugins: dict[str, set[str]] = defaultdict(set)
        self._marketplace = PluginMarketplace()
        self._sandbox = SandboxExecutor()
        self._contributions = ContributionRegistry()
        self._extensions: dict[str, ExtensionManifest] = {}
        #: Points already read, so a point's activation event fires once.
        self._fired_points: set[str] = set()

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
        for dependency in record.manifest.dependencies:
            if dependency in self._records:
                self.activate_plugin(dependency)
        if record.implementation is None:
            record.implementation = record.factory()
        self._pm.register(record.implementation, name=name)
        self._collect_contributions(name, record)
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
        """Drop one plugin's contributions and unregister it."""
        self._contributions.dispose_plugin(name)
        try:
            self._pm.unregister(record.implementation)
        except Exception as error:  # noqa: BLE001
            logger.warning(
                "Plugin %s could not be unregistered from pluggy: %s", name, error
            )
        record.activated = False
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
        record = self._get_record(name)
        self._contributions.dispose_plugin(name)
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

    def enable_plugin(self, name: str) -> None:
        record = self._get_record(name)
        record.enabled = True

    def disable_plugin(self, name: str) -> None:
        record = self._get_record(name)
        record.enabled = False

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
        self._invoke_enabled_hook("on_reactor_start", tenant_id=tenant_id)

    def stop(self, tenant_id: str | None = None) -> None:
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
