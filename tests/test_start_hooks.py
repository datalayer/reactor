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


def test_a_plugin_woken_after_start_is_started_once() -> None:
    """Woken by an event while the platform runs, it has missed `start()`."""
    platform = PluginPlatform()
    eager, waiting = Counting(), Counting()
    platform.register_plugin(PluginManifest(name="eager", version="1.0.0"), eager)
    platform.register_plugin(
        PluginManifest(name="waiting", version="1.0.0", activation_events=["onToolset:geo"]),
        waiting,
    )
    platform.start()
    assert (eager.started, waiting.started) == (1, 0)
    platform.fire_event("onToolset:geo")
    assert (eager.started, waiting.started) == (1, 1)
    platform.fire_event("onToolset:geo")
    assert waiting.started == 1


def test_a_plugin_registered_after_start_is_started() -> None:
    platform = PluginPlatform()
    platform.start()
    late = Counting()
    platform.register_plugin(PluginManifest(name="late", version="1.0.0"), late)
    assert late.started == 1


def test_a_plugin_woken_before_start_waits_for_it() -> None:
    platform = PluginPlatform()
    waiting = Counting()
    platform.register_plugin(
        PluginManifest(name="waiting", version="1.0.0", activation_events=["onToolset:geo"]),
        waiting,
    )
    platform.fire_event("onToolset:geo")
    assert waiting.started == 0
    platform.start()
    assert waiting.started == 1


def test_a_plugin_stood_down_while_running_is_stopped() -> None:
    """It will not be there for `stop()`: told now, while it can release."""
    platform = PluginPlatform()
    plugin = Counting()
    platform.register_plugin(
        PluginManifest(
            name="p",
            version="1.0.0",
            activation_events=["onToolset:geo"],
            deactivation_events=["onToolset:done"],
        ),
        plugin,
    )
    platform.start()
    platform.fire_event("onToolset:geo")
    platform.fire_event("onToolset:done")
    assert (plugin.started, plugin.stopped) == (1, 1)
    platform.stop()
    assert plugin.stopped == 1


def test_a_failing_start_costs_only_that_plugin() -> None:
    class Failing(Counting):
        @hookimpl
        def on_reactor_start(self, tenant_id: str | None = None) -> None:
            raise RuntimeError("no")

    platform = PluginPlatform()
    platform.start()
    platform.register_plugin(PluginManifest(name="bad", version="1.0.0"), Failing())
    good = Counting()
    platform.register_plugin(PluginManifest(name="good", version="1.0.0"), good)
    assert good.started == 1
