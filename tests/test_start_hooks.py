# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Start hooks run once per plugin, and a host can reach a plugin's object."""

from __future__ import annotations

from reactor import PluginManifest, PluginPlatform
from reactor.hooks import hookimpl


class Counting:
    def __init__(self) -> None:
        self.started = 0
        self.stopped = 0

    @hookimpl
    def on_reactor_start(self, tenant_id: str | None = None) -> None:
        self.started += 1

    @hookimpl
    def on_reactor_stop(self, tenant_id: str | None = None) -> None:
        self.stopped += 1


def test_each_plugin_starts_once_however_many_there_are() -> None:
    platform = PluginPlatform()
    plugins = [Counting() for _ in range(7)]
    for index, plugin in enumerate(plugins):
        platform.register_plugin(PluginManifest(name=f"p{index}", version="1.0.0"), plugin)
    platform.start()
    assert [plugin.started for plugin in plugins] == [1] * 7
    platform.stop()
    assert [plugin.stopped for plugin in plugins] == [1] * 7


def test_a_disabled_plugin_is_left_out() -> None:
    platform = PluginPlatform()
    on, off = Counting(), Counting()
    platform.register_plugin(PluginManifest(name="on", version="1.0.0"), on)
    platform.register_plugin(PluginManifest(name="off", version="1.0.0"), off)
    platform.disable_plugin("off")
    platform.start()
    assert (on.started, off.started) == (1, 0)


def test_implementation_of_answers_the_live_object_or_none() -> None:
    platform = PluginPlatform()
    plugin = Counting()
    platform.register_plugin(PluginManifest(name="p", version="1.0.0"), plugin)
    assert platform.implementation_of("p") is plugin
    assert platform.implementation_of("nobody") is None
