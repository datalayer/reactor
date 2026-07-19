# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

from __future__ import annotations

from collections import defaultdict
from dataclasses import asdict
from typing import Any

import pluggy

from .hooks import ReactorHookSpecs
from .marketplace import MarketplaceEntry, PluginMarketplace
from .sandbox import SandboxExecutor
from .types import PluginManifest, PluginRecord


class PluginPlatform:
    """Platform-grade plugin runtime with marketplace and tenant-aware lifecycle."""

    PLATFORM_VERSION = "0.1.0"

    def __init__(self):
        self._pm = pluggy.PluginManager("datalayer_reactor")
        self._pm.add_hookspecs(ReactorHookSpecs)
        self._records: dict[str, PluginRecord] = {}
        self._tenant_plugins: dict[str, set[str]] = defaultdict(set)
        self._marketplace = PluginMarketplace()
        self._sandbox = SandboxExecutor()

    @property
    def marketplace(self) -> PluginMarketplace:
        return self._marketplace

    def publish(self, manifest: PluginManifest, source: str) -> None:
        self._marketplace.publish(MarketplaceEntry(manifest=manifest, source=source))

    def register_plugin(
        self,
        manifest: PluginManifest,
        plugin_impl: Any,
        *,
        sandboxed: bool = False,
        auto_enable: bool = True,
    ) -> None:
        self._assert_compatible(manifest)
        self._assert_dependencies(manifest)

        record = PluginRecord(
            manifest=manifest,
            factory=lambda: plugin_impl,
            implementation=plugin_impl,
            enabled=auto_enable,
            sandboxed=sandboxed,
        )
        self._records[manifest.name] = record

        for tenant_scope in manifest.tenant_scopes:
            if tenant_scope == "*":
                continue
            self._tenant_plugins[tenant_scope].add(manifest.name)

        self._pm.register(plugin_impl, name=manifest.name)

    def list_plugins(self) -> list[dict[str, Any]]:
        return [
            {
                **asdict(record.manifest),
                "enabled": record.enabled,
                "sandboxed": record.sandboxed,
            }
            for record in self._records.values()
        ]

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
