# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""The extensible REPL, headless.

The prompt itself needs a terminal; everything around it — the registry, the
dispatch, the follow-up convention, the exit — does not, and that is what a
plugin author relies on.
"""

import pytest

from reactor.repl import ReactorRepl, ReplExit
from reactor.slash import (
    CommandArgSpec,
    CommandCollisionError,
    SlashCommandRegistry,
    SlashCommandSpec,
)


def make_registry():
    registry = SlashCommandRegistry()
    seen = []

    async def hello(argv):
        seen.append(("hello", argv))
        return None

    async def suggest(argv):
        return "run the demo"

    async def leave(argv):
        raise ReplExit()

    registry.register(
        SlashCommandSpec(name="hello", aliases=("hi",), handler=hello)
    )
    registry.register(SlashCommandSpec(name="suggest", handler=suggest))
    registry.register(SlashCommandSpec(name="exit", handler=leave))
    return registry, seen


@pytest.mark.asyncio
async def test_dispatch_resolves_names_and_aliases():
    registry, seen = make_registry()
    repl = ReactorRepl(registry, printer=lambda line: None)

    assert await repl.dispatch("/hello world") is True
    assert await repl.dispatch("/hi again") is True
    assert seen == [("hello", "world"), ("hello", "again")]


@pytest.mark.asyncio
async def test_plain_text_is_not_a_command():
    registry, _ = make_registry()
    repl = ReactorRepl(registry, printer=lambda line: None)
    assert await repl.dispatch("just a thought") is False


@pytest.mark.asyncio
async def test_follow_up_prompt_reaches_the_responder():
    registry, _ = make_registry()
    answered = []

    async def respond(text):
        answered.append(text)

    repl = ReactorRepl(registry, respond=respond, printer=lambda line: None)
    await repl.dispatch("/suggest")
    # The pick becomes a message, exactly as if the person had typed it.
    assert answered == ["run the demo"]


@pytest.mark.asyncio
async def test_unknown_commands_are_reported_not_ignored():
    registry, _ = make_registry()
    printed = []
    repl = ReactorRepl(registry, printer=printed.append)
    assert await repl.dispatch("/nope") is True
    assert any("Unknown command" in line for line in printed)


@pytest.mark.asyncio
async def test_a_command_can_end_the_loop():
    registry, _ = make_registry()
    repl = ReactorRepl(registry, printer=lambda line: None)
    with pytest.raises(ReplExit):
        await repl.dispatch("/exit")


def test_collisions_are_refused_with_the_culprit_named():
    registry, _ = make_registry()
    with pytest.raises(CommandCollisionError):
        registry.register(SlashCommandSpec(name="hi", source="a-plugin"))


def test_argument_choices_resolve_live():
    calls = []

    def choices():
        calls.append(1)
        return ("alpha", "beta")

    spec = CommandArgSpec(name="which", choices=choices)
    assert spec.resolve_choices() == ("alpha", "beta")
    assert calls  # resolved at ask time, not at declaration
