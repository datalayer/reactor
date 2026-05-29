import pluggy

hookspec = pluggy.HookspecMarker("datalayer_reactor")
hookimpl = pluggy.HookimplMarker("datalayer_reactor")


class ReactorHookSpecs:
    @hookspec
    def on_platform_start(self, tenant_id: str | None = None) -> None:
        """Called when the platform starts globally or for a tenant."""

    @hookspec
    def on_platform_stop(self, tenant_id: str | None = None) -> None:
        """Called when the platform stops globally or for a tenant."""

    @hookspec
    def provide_routes(self) -> list[dict]:
        """Return route descriptors consumed by API or gateway layers."""

    @hookspec
    def feature_flags(self, tenant_id: str) -> dict[str, bool]:
        """Return plugin-provided feature flags for a tenant."""
