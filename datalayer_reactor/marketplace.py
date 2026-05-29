from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from .types import PluginManifest


@dataclass
class MarketplaceEntry:
    manifest: PluginManifest
    source: str


class PluginMarketplace:
    """In-memory marketplace to discover plugins and versions."""

    def __init__(self):
        self._entries: dict[str, list[MarketplaceEntry]] = {}

    def publish(self, entry: MarketplaceEntry) -> None:
        self._entries.setdefault(entry.manifest.name, []).append(entry)

    def list_plugins(self) -> list[PluginManifest]:
        manifests: list[PluginManifest] = []
        for entries in self._entries.values():
            manifests.extend(entry.manifest for entry in entries)
        return manifests

    def find_versions(self, plugin_name: str) -> Iterable[MarketplaceEntry]:
        return self._entries.get(plugin_name, [])
