import random

from datalayer_reactor import PluginCompatibility, PluginManifest, PluginPlatform, create_reactor_app


class RandomCounterGreetingPlugin:
    def __init__(self) -> None:
        self._counter = 0

    def provide_routes(self) -> list[dict]:
        return [{"path": "/greet", "method": "GET", "plugin": "greeting"}]

    def feature_flags(self, tenant_id: str) -> dict[str, bool]:
        return {"greeting.widget": True}

    def invoke_action(
        self,
        action: str,
        payload: dict | None = None,
        tenant_id: str | None = None,
    ) -> dict:
        if action != "greet":
            raise ValueError(f"Unsupported action '{action}' for greeting-plugin")

        data = payload or {}
        username = data.get("name", "Developer")
        increment = random.randint(1, 7)
        self._counter += increment
        return {
            "message": (
                f"Hello {username}, greeting-plugin executed successfully "
                f"with counter {self._counter}."
            ),
            "counter": self._counter,
            "increment": increment,
            "plugin": "greeting-plugin",
            "tenant": tenant_id or "default",
        }


class RandomCounterStatusPlugin:
    def __init__(self) -> None:
        self._counter = 0

    def provide_routes(self) -> list[dict]:
        return [{"path": "/status", "method": "GET", "plugin": "status"}]

    def feature_flags(self, tenant_id: str) -> dict[str, bool]:
        return {"status.banner": tenant_id != "free-tier"}

    def invoke_action(
        self,
        action: str,
        payload: dict | None = None,
        tenant_id: str | None = None,
    ) -> dict:
        if action != "status":
            raise ValueError(f"Unsupported action '{action}' for status-plugin")

        increment = random.randint(1, 7)
        self._counter += increment
        return {
            "state": "ready",
            "counter": self._counter,
            "increment": increment,
            "plugin": "status-plugin",
            "tenant": tenant_id or "default",
        }


reactor = PluginPlatform()

reactor.register_plugin(
    PluginManifest(
        name="greeting-plugin",
        version="1.0.0",
        description="Simple greeting plugin",
        compatibility=PluginCompatibility(api_version="v1"),
    ),
    RandomCounterGreetingPlugin(),
)

reactor.register_plugin(
    PluginManifest(
        name="status-plugin",
        version="1.0.0",
        description="Simple status plugin",
        compatibility=PluginCompatibility(api_version="v1"),
    ),
    RandomCounterStatusPlugin(),
)

app = create_reactor_app(reactor)
