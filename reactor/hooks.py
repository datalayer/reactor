# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

import pluggy

hookspec = pluggy.HookspecMarker("reactor")
hookimpl = pluggy.HookimplMarker("reactor")


class ReactorHookSpecs:
    @hookspec
    def on_reactor_start(self, tenant_id: str | None = None) -> None:
        """Called when the reactor starts globally or for a tenant."""

    @hookspec
    def on_reactor_stop(self, tenant_id: str | None = None) -> None:
        """Called when the reactor stops globally or for a tenant."""

    @hookspec
    def provide_routes(self) -> list[dict]:
        """Return route descriptors consumed by API or gateway layers."""

    @hookspec
    def feature_flags(self, tenant_id: str) -> dict[str, bool]:
        """Return plugin-provided feature flags for a tenant."""
