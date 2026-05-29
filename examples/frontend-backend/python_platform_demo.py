from datalayer_reactor import PluginCompatibility, PluginManifest, PluginPlatform, create_platform_app
from datalayer_reactor.example_plugins import GreetingPlugin, StatusPlugin


platform = PluginPlatform()

platform.register_plugin(
    PluginManifest(
        name="greeting-plugin",
        version="1.0.0",
        description="Simple greeting plugin",
        compatibility=PluginCompatibility(api_version="v1"),
    ),
    GreetingPlugin(),
)

platform.register_plugin(
    PluginManifest(
        name="status-plugin",
        version="1.0.0",
        description="Simple status plugin",
        compatibility=PluginCompatibility(api_version="v1"),
    ),
    StatusPlugin(),
)

app = create_platform_app(platform)
