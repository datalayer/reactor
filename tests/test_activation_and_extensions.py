# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Activation events and extensions, on the Python side.

Both mirror the TypeScript runtime, so the tests are deliberately the same
questions asked of the other tier: a held plugin is listed but silent, an
extension groups without governing, and a plugin woken by an event finds its
dependencies already up.
"""

from __future__ import annotations

import pytest

from reactor import (
    ExtensionManifest,
    PluginManifest,
    PluginPlatform,
    define_contribution_point,
    matches_activation,
    matches_deactivation,
    on_command,
    on_contribution_point,
)

TOOLBAR = define_contribution_point("tests.toolbar")


class _Contributor:
    """Contributes one toolbar item, and records that it was ever built."""

    built = 0

    def __init__(self, label: str) -> None:
        self.label = label
        type(self).built += 1

    def provide_contributions(self, contributions) -> None:
        contributions.contribute(TOOLBAR, {"label": self.label})


def _manifest(name: str, **kwargs) -> PluginManifest:
    return PluginManifest(name=name, version="1.0.0", **kwargs)


class TestMatchesActivation:
    def test_nothing_declared_means_startup(self):
        assert matches_activation([], "onStartup") is True
        assert matches_activation(None, "onView:x") is False

    def test_star_matches_anything(self):
        assert matches_activation(["*"], "onStartup") is True
        assert matches_activation(["*"], "onAnythingAtAll") is True

    def test_matching_is_exact(self):
        # `onView:note` waking on `onView:notebook` is the classic bug here.
        assert matches_activation(["onView:note"], "onView:notebook") is False
        assert matches_activation(["onView:notebook"], "onView:notebook") is True


class TestActivationEvents:
    def test_a_plugin_that_waits_contributes_nothing_until_it_fires(self):
        platform = PluginPlatform()
        platform.register_plugin(
            _manifest("late", activation_events=[on_command("open")]),
            _Contributor("Late"),
        )

        assert platform.get_contributions(TOOLBAR) == []
        # Listed and describable the whole time — the point of keeping the
        # manifest separate from the implementation.
        assert [entry["name"] for entry in platform.list_plugins()] == ["late"]
        assert platform.list_plugins()[0]["activated"] is False

        fired = platform.fire_event(on_command("open"))

        assert fired["activated"] == ["late"]
        assert [c.value["label"] for c in platform.get_contributions(TOOLBAR)] == ["Late"]

    def test_a_factory_is_not_called_until_activation(self):
        platform = PluginPlatform()
        calls: list[str] = []

        platform.register_plugin(
            _manifest("deferred", activation_events=[on_command("go")]),
            factory=lambda: calls.append("built") or _Contributor("Deferred"),
        )

        assert calls == []
        platform.fire_event(on_command("go"))
        assert calls == ["built"]

    def test_an_unwanted_event_wakes_nothing(self):
        platform = PluginPlatform()
        platform.register_plugin(
            _manifest("x", activation_events=["onView:a"]), _Contributor("X")
        )

        assert platform.fire_event("onView:b")["activated"] == []
        # Firing into the void must be free, not an error: hosts fire liberally.
        assert platform.fire_event("onNothing") == {"deactivated": [], "activated": []}

    def test_activation_happens_once(self):
        platform = PluginPlatform()
        platform.register_plugin(
            _manifest("twice", activation_events=["onView:a", "onView:b"]),
            _Contributor("Twice"),
        )

        platform.fire_event("onView:a")
        platform.fire_event("onView:b")

        assert len(platform.get_contributions(TOOLBAR)) == 1

    def test_dependencies_are_activated_first(self):
        platform = PluginPlatform()
        order: list[str] = []

        class _Dependency:
            def provide_contributions(self, contributions) -> None:
                order.append("dependency")

        class _Dependant:
            def provide_contributions(self, contributions) -> None:
                order.append("dependant")

        # Waiting on an event that never fires: it must still come up, because
        # something that needs it did.
        platform.register_plugin(
            _manifest("dependency", activation_events=["onView:never"]), _Dependency()
        )
        platform.register_plugin(
            _manifest(
                "dependant",
                dependencies=["dependency"],
                activation_events=["onView:now"],
            ),
            _Dependant(),
        )

        platform.fire_event("onView:now")

        assert order == ["dependency", "dependant"]

    def test_reading_a_point_activates_what_was_waiting_on_it(self):
        platform = PluginPlatform()
        platform.register_plugin(
            _manifest(
                "on-read", activation_events=[on_contribution_point(TOOLBAR.id)]
            ),
            _Contributor("Woken"),
        )

        # Synchronous on this tier: no module is on the wire, so the plugin it
        # wakes is in the list this very call returns.
        assert [c.value["label"] for c in platform.get_contributions(TOOLBAR)] == [
            "Woken"
        ]

    def test_a_plugin_needs_an_implementation_or_a_factory(self):
        platform = PluginPlatform()
        with pytest.raises(ValueError, match="implementation or a factory"):
            platform.register_plugin(_manifest("nothing"))


class TestExtensions:
    def _register(self, platform: PluginPlatform) -> ExtensionManifest:
        extension = ExtensionManifest(
            name="notebooks",
            version="1.0.0",
            display_name="Notebooks",
            emoji="📓",
        )
        platform.register_extension(
            extension,
            [
                (_manifest("editor"), _Contributor("Editor")),
                (_manifest("editor-toolbar"), _Contributor("Run")),
            ],
        )
        return extension

    def test_registers_the_plugins_it_groups_not_itself(self):
        platform = PluginPlatform()
        self._register(platform)

        assert [entry["name"] for entry in platform.list_plugins()] == [
            "editor",
            "editor-toolbar",
        ]
        # The extension is not a plugin, and must not answer as one.
        with pytest.raises(KeyError):
            platform.invoke_plugin_action("notebooks", "anything")

    def test_stamps_the_grouping_onto_each_manifest(self):
        platform = PluginPlatform()
        self._register(platform)

        assert {
            entry["name"]: entry["extension"] for entry in platform.list_plugins()
        } == {"editor": "notebooks", "editor-toolbar": "notebooks"}

    def test_lists_the_extension_and_what_it_delivered(self):
        platform = PluginPlatform()
        self._register(platform)

        assert platform.list_extensions() == [
            {
                "name": "notebooks",
                "version": "1.0.0",
                "display_name": "Notebooks",
                "description": "",
                "octicon": "",
                "emoji": "📓",
                "plugins": ["editor", "editor-toolbar"],
            }
        ]

    def test_leaves_a_loose_plugin_ungrouped(self):
        platform = PluginPlatform()
        self._register(platform)
        platform.register_plugin(_manifest("loose"), _Contributor("Loose"))

        by_name = {entry["name"]: entry for entry in platform.list_plugins()}
        assert by_name["loose"]["extension"] == ""
        assert platform.list_extensions()[0]["plugins"] == ["editor", "editor-toolbar"]

    def test_members_are_still_disabled_one_at_a_time(self):
        platform = PluginPlatform()
        self._register(platform)
        assert len(platform.get_contributions(TOOLBAR)) == 2

        platform.disable_plugin("editor-toolbar")

        assert [c.plugin for c in platform.get_contributions(TOOLBAR)] == ["editor"]


class TestDeactivation:
    """Standing down, and why it is not the same as being switched off."""

    def test_matches_deactivation_never_fires_when_nothing_is_declared(self):
        # The asymmetry with activation, and the reason for a second function:
        # an empty activation list means "at startup", an empty deactivation
        # list means never. Point both the same way and every plugin that said
        # nothing is torn down by the first event anyone fires.
        assert matches_deactivation([], "onStartup") is False
        assert matches_deactivation(None, "onView:x") is False
        assert matches_deactivation(["onView:x"], "onView:x") is True
        assert matches_deactivation(["*"], "onWhatever") is True

    def test_drops_what_the_plugin_contributed(self):
        platform = PluginPlatform()
        platform.register_plugin(_manifest("live"), _Contributor("Live"))
        assert len(platform.get_contributions(TOOLBAR)) == 1

        assert platform.deactivate_plugin("live") == ["live"]

        assert platform.get_contributions(TOOLBAR) == []
        assert platform.list_plugins()[0]["activated"] is False

    def test_leaves_the_plugin_registered_and_enabled(self):
        platform = PluginPlatform()
        platform.register_plugin(_manifest("live"), _Contributor("Live"))

        platform.deactivate_plugin("live")

        # Standing down is not unregistering and not disabling.
        entry = platform.list_plugins()[0]
        assert entry["name"] == "live"
        assert entry["enabled"] is True

    def test_is_a_no_op_on_a_plugin_that_never_activated(self):
        platform = PluginPlatform()
        platform.register_plugin(
            _manifest("waiting", activation_events=["onView:x"]), _Contributor("W")
        )

        assert platform.deactivate_plugin("waiting") == []

    def test_stands_dependants_down_first(self):
        platform = PluginPlatform()
        platform.register_plugin(_manifest("base"), _Contributor("Base"))
        platform.register_plugin(
            _manifest("middle", dependencies=["base"]), _Contributor("Middle")
        )
        platform.register_plugin(
            _manifest("top", dependencies=["middle"]), _Contributor("Top")
        )

        # Deepest first: nothing is torn down while something holding its
        # contributions is still up.
        assert platform.deactivate_plugin("base") == ["top", "middle", "base"]
        assert all(
            entry["activated"] is False for entry in platform.list_plugins()
        )

    def test_one_event_retires_one_plugin_and_wakes_another(self):
        platform = PluginPlatform()
        platform.register_plugin(
            _manifest("document-mode", deactivation_events=["onView:notebook"]),
            _Contributor("Document"),
        )
        platform.register_plugin(
            _manifest("notebook-mode", activation_events=["onView:notebook"]),
            _Contributor("Notebook"),
        )
        assert [c.value["label"] for c in platform.get_contributions(TOOLBAR)] == [
            "Document"
        ]

        fired = platform.fire_event("onView:notebook")

        # Down before up, in one call.
        assert fired == {
            "deactivated": ["document-mode"],
            "activated": ["notebook-mode"],
        }
        assert [c.value["label"] for c in platform.get_contributions(TOOLBAR)] == [
            "Notebook"
        ]

    def test_a_plugin_that_stood_down_comes_back(self):
        platform = PluginPlatform()
        platform.register_plugin(
            _manifest(
                "cycle",
                activation_events=["onView:in"],
                deactivation_events=["onView:out"],
            ),
            _Contributor("Cycled"),
        )

        platform.fire_event("onView:in")
        assert len(platform.get_contributions(TOOLBAR)) == 1
        platform.fire_event("onView:out")
        assert platform.get_contributions(TOOLBAR) == []
        platform.fire_event("onView:in")

        # Exactly once, not twice: coming back must not double what it gives.
        assert len(platform.get_contributions(TOOLBAR)) == 1

    def test_can_be_woken_again_by_a_read_of_its_point(self):
        platform = PluginPlatform()
        platform.register_plugin(
            _manifest(
                "on-read",
                activation_events=[on_contribution_point(TOOLBAR.id)],
                deactivation_events=["onCommand:close"],
            ),
            _Contributor("Read"),
        )

        assert len(platform.get_contributions(TOOLBAR)) == 1
        platform.fire_event("onCommand:close")

        # Checked through `list_plugins`, not by reading the point: activation
        # on this tier is synchronous, so reading the very point that revives
        # this plugin would revive it before the assertion could see it gone.
        # (The TypeScript tier defers a read-triggered activation to a
        # microtask, so the same read there returns empty once.)
        assert platform.list_plugins()[0]["activated"] is False
        assert platform.describe_contributions() == []

        # And now the read, which is exactly what should bring it back: a
        # point fires its activation event once so a plugin is not
        # re-activated on every read, and standing down lifts that guard for
        # this point — otherwise a plugin woken by a read could never be
        # woken by one again.
        assert len(platform.get_contributions(TOOLBAR)) == 1
        assert platform.list_plugins()[0]["activated"] is True

    def test_a_plugin_with_no_deactivation_events_is_left_alone(self):
        platform = PluginPlatform()
        platform.register_plugin(_manifest("steady"), _Contributor("Steady"))

        platform.fire_event("onView:away")

        assert len(platform.get_contributions(TOOLBAR)) == 1
