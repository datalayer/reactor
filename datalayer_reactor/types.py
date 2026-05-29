from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable


@dataclass(frozen=True)
class PluginCompatibility:
    api_version: str
    min_platform_version: str = "0.1.0"
    max_platform_version: str | None = None


@dataclass(frozen=True)
class PluginManifest:
    name: str
    version: str
    description: str = ""
    author: str = ""
    tags: list[str] = field(default_factory=list)
    dependencies: list[str] = field(default_factory=list)
    tenant_scopes: list[str] = field(default_factory=lambda: ["*"])
    compatibility: PluginCompatibility = field(
        default_factory=lambda: PluginCompatibility(api_version="v1")
    )


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
