# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Switching a plugin off should switch off what depends on it.

`deactivate_plugin` has always stood dependants down; `disable_plugin` did not,
which left a dependant answering for an output nobody maintained. These are the
questions that distinction raises, and the last one is the one that makes the
feature safe rather than merely tidy.
"""

from __future__ import annotations

from reactor import PluginManifest, PluginPlatform


def chain() -> PluginPlatform:
    """base ← middle ← top."""
    platform = PluginPlatform()
    platform.register_plugin(PluginManifest(name="base", version="1.0.0"), object())
    platform.register_plugin(
        PluginManifest(name="middle", version="1.0.0", dependencies=["base"]), object()
    )
    platform.register_plugin(
        PluginManifest(name="top", version="1.0.0", dependencies=["middle"]), object()
    )
    return platform


def enabled(platform: PluginPlatform) -> set[str]:
    return {p["name"] for p in platform.list_plugins() if p["enabled"]}


def test_disable_takes_dependants_with_it_transitively() -> None:
    platform = chain()
    disabled = platform.disable_plugin("base")

    # Dependants first: nothing is left holding what has already gone.
    assert disabled == ["top", "middle", "base"]
    assert enabled(platform) == set()


def test_enable_brings_back_only_what_it_took() -> None:
    platform = chain()
    platform.disable_plugin("base")
    assert platform.enable_plugin("base") == ["base", "middle", "top"]
    assert enabled(platform) == {"base", "middle", "top"}


def test_a_persons_switch_outlives_a_dependency_coming_back() -> None:
    """The invariant that makes the cascade safe.

    Somebody turned `top` off deliberately. Disabling and re-enabling `base` —
    an unrelated act, two plugins away — must not turn it back on.
    """
    platform = chain()
    platform.disable_plugin("top")
    platform.disable_plugin("base")
    platform.enable_plugin("base")

    assert enabled(platform) == {"base", "middle"}
    states = {p["name"]: p["disabled_by"] for p in platform.list_plugins()}
    assert states["top"] == "user"
    assert states["base"] == ""


def test_a_dependant_stays_down_while_another_dependency_is_off() -> None:
    platform = PluginPlatform()
    platform.register_plugin(PluginManifest(name="a", version="1.0.0"), object())
    platform.register_plugin(PluginManifest(name="b", version="1.0.0"), object())
    platform.register_plugin(
        PluginManifest(name="both", version="1.0.0", dependencies=["a", "b"]), object()
    )

    platform.disable_plugin("a")
    platform.disable_plugin("b")
    platform.enable_plugin("a")

    # `both` needs them both; one back is not enough.
    assert enabled(platform) == {"a"}
    platform.enable_plugin("b")
    assert enabled(platform) == {"a", "b", "both"}


def test_disabling_reports_nothing_when_already_off() -> None:
    platform = chain()
    platform.disable_plugin("base")
    assert platform.disable_plugin("base") == []
    assert platform.enable_plugin("base") == ["base", "middle", "top"]
    assert platform.enable_plugin("base") == []


def test_unregistering_something_absent_changes_no_revision() -> None:
    """A question is not a change.

    The revision is what an SSE client watches. Bumping it because somebody
    asked about a plugin that is not here would wake every browser attached to
    this server to tell them nothing happened.
    """
    import pytest

    platform = PluginPlatform()
    platform.register_plugin(PluginManifest(name="a", version="1.0.0"), object())
    before = platform.revision

    with pytest.raises(Exception):
        platform.unregister_plugin("not-here")
    assert platform.revision == before

    platform.unregister_plugin("a")
    assert platform.revision > before
