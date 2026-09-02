# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""The command registry: plugins register, the host invokes."""

from __future__ import annotations

import pytest

from reactor import Command, PluginManifest, PluginPlatform


class _MusicPlugin:
    """Registers two commands, one of them gated."""

    def __init__(self) -> None:
        self.played: list[str] = []
        self.playlist: list[str] = []

    def provide_slash_commands(self, commands) -> None:
        commands.add(
            "music.play",
            "Play a random song",
            lambda: self.played.append("random"),
            description="Pick something and play it",
            emoji="▶️",
            octicon="play",
            category="Music",
        )
        commands.register(
            Command(
                id="music.clear",
                name="Clear the playlist",
                execute=self.playlist.clear,
                emoji="🧹",
                # Nothing to clear is not an error, it is an unavailable command.
                is_enabled=lambda: bool(self.playlist),
                order=10,
            )
        )


def _platform() -> tuple[PluginPlatform, _MusicPlugin]:
    platform = PluginPlatform()
    plugin = _MusicPlugin()
    platform.register_plugin(
        PluginManifest(name="music", version="1.0.0", description="Music"),
        plugin,
    )
    return platform, plugin


def test_registers_what_a_plugin_offers() -> None:
    platform, _ = _platform()

    commands = platform.list_commands()
    assert [c.id for c in commands] == ["music.play", "music.clear"]

    play = commands[0]
    assert play.name == "Play a random song"
    assert play.emoji == "▶️"
    assert play.category == "Music"


@pytest.mark.asyncio
async def test_runs_a_command() -> None:
    platform, plugin = _platform()

    await platform.execute_command("music.play")

    assert plugin.played == ["random"]


@pytest.mark.asyncio
async def test_awaits_an_async_command() -> None:
    ran: list[str] = []

    class _AsyncPlugin:
        def provide_slash_commands(self, commands) -> None:
            async def slow() -> str:
                ran.append("slow")
                return "done"

            commands.add("async.slow", "Slow", slow)

    platform = PluginPlatform()
    platform.register_plugin(PluginManifest(name="async", version="1.0.0"), _AsyncPlugin())

    assert await platform.execute_command("async.slow") == "done"
    assert ran == ["slow"]


@pytest.mark.asyncio
async def test_passes_an_argument_to_a_handler_that_takes_one() -> None:
    seen: list[object] = []

    class _EchoPlugin:
        def provide_slash_commands(self, commands) -> None:
            commands.add("echo", "Echo", lambda value: seen.append(value))

    platform = PluginPlatform()
    platform.register_plugin(PluginManifest(name="echo", version="1.0.0"), _EchoPlugin())

    await platform.execute_command("echo", "hello")

    assert seen == ["hello"]


@pytest.mark.asyncio
async def test_lists_an_unavailable_command_but_refuses_to_run_it() -> None:
    platform, plugin = _platform()

    # Listed while unavailable: a command that vanishes looks like a lost
    # feature, and saying why beats pretending it was never there.
    assert "music.clear" in {c.id for c in platform.list_commands()}
    with pytest.raises(RuntimeError, match="not available right now"):
        await platform.execute_command("music.clear")

    plugin.playlist.append("a song")
    await platform.execute_command("music.clear")
    assert plugin.playlist == []


@pytest.mark.asyncio
async def test_unknown_command() -> None:
    platform, _ = _platform()

    with pytest.raises(KeyError):
        await platform.execute_command("nope")


def test_refuses_a_duplicate_id() -> None:
    class _ClashingPlugin:
        def provide_slash_commands(self, commands) -> None:
            commands.add("music.play", "Also play", lambda: None)

    platform, _ = _platform()
    # The failure is contained: a plugin that cannot register its commands is
    # still registered, like one that fails to contribute.
    platform.register_plugin(
        PluginManifest(name="clash", version="1.0.0"), _ClashingPlugin()
    )

    owners = {c.id: platform._commands.owner(c.id) for c in platform.list_commands()}
    assert owners["music.play"] == "music"


def test_commands_go_with_the_plugin() -> None:
    platform, _ = _platform()
    assert len(platform.list_commands()) == 2

    platform.unregister_plugin("music")

    assert platform.list_commands() == []


def test_disabling_a_plugin_hides_its_commands() -> None:
    platform, _ = _platform()

    platform.disable_plugin("music")
    assert platform.list_commands() == []

    platform.enable_plugin("music")
    assert [c.id for c in platform.list_commands()] == ["music.play", "music.clear"]


def test_describe_is_json_and_names_the_plugin() -> None:
    platform, _ = _platform()

    described = platform.describe_commands()

    assert described[0]["id"] == "music.play"
    assert described[0]["plugin"] == "music"
    assert described[0]["emoji"] == "▶️"
    # `enabled` is resolved for the caller: a browser drawing the palette has
    # no way to run the predicate itself.
    assert described[0]["enabled"] is True
    assert described[1]["enabled"] is False


def test_a_failing_enablement_predicate_means_unavailable() -> None:
    class _BrokenGate:
        def provide_slash_commands(self, commands) -> None:
            def explode() -> bool:
                raise RuntimeError("the predicate is broken")

            commands.add("broken", "Broken", lambda: None, is_enabled=explode)

    platform = PluginPlatform()
    platform.register_plugin(PluginManifest(name="broken", version="1.0.0"), _BrokenGate())

    command = platform.list_commands()[0]
    assert command.enabled is False
