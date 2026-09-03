# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""An extensible REPL, built on the reactor.

The sibling of the CLI example one folder over: same platform, same plugin,
different surface. The host owns its built-in commands — ``/help`` and
``/exit`` here — and what it does with a plain line (echo it back, uppercased,
standing in for whatever a real host answers with). Everything else arrives as
reactor plugins: each one implements ``provide_slash_commands``, receives the
registry, and registers what it ships. The clock plugin below adds ``/time``,
with an argument whose completions show up in the slash menu.

Run it from this folder — the ``reactor`` package resolves from the checkout
two folders up when it is not installed; ``prompt_toolkit`` is the one hard
prerequisite (``pip install "datalayer_reactor[repl]"``)::

    python host.py

    ❯ /help                # the menu: type / and it completes
    ❯ /time                # from the plugin
    ❯ /time utc            # its argument completes too
    ❯ anything else        # goes to respond()
    ❯ /exit
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

try:
    import reactor  # noqa: F401
except ImportError:
    # Running from a plain checkout: the package sits two folders up.
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from reactor import SlashCommandRegistry, SlashCommandSpec
from reactor.repl import ReactorRepl, ReplExit


def build_registry(repl_holder: dict) -> SlashCommandRegistry:
    """The host's own commands. Plugins add theirs through the platform."""
    registry = SlashCommandRegistry()

    async def help_command(argv: str) -> None:
        print("Commands, by group:")
        for group, specs in registry.by_group().items():
            print(f"  {group}")
            for spec in specs:
                names = ", ".join(f"/{name}" for name in spec.names)
                print(f"    {names:24} {spec.description}")
        return None

    async def exit_command(argv: str) -> None:
        print("Bye.")
        raise ReplExit()

    registry.register(
        SlashCommandSpec(
            name="help",
            description="Show available commands",
            group="Session",
            handler=help_command,
        )
    )
    registry.register(
        SlashCommandSpec(
            name="exit",
            aliases=("quit",),
            description="Leave the session",
            group="Session",
            shortcut="escape q",
            handler=exit_command,
        )
    )
    return registry


async def main() -> None:
    holder: dict = {}
    registry = build_registry(holder)

    async def respond(text: str) -> None:
        # A real host sends this to an agent, an interpreter, a search box.
        print(f"you said: {text.upper()}")

    repl = ReactorRepl(registry, respond=respond, prompt="<ansicyan>❯ </ansicyan>")
    holder["repl"] = repl

    # Plugins. Installed distributions first — whatever advertises itself
    # under the entry-point group registers, nothing is named here — then the
    # local example plugin directly, so a plain checkout has something to
    # show. A held plugin needs no platform: the hook is one method call.
    found = repl.discover("reactor.demo.repl")
    from clock_plugin import plugin

    _manifest, implementation = plugin()
    if "clock" not in found:
        implementation.provide_slash_commands(registry)

    print("An extensible REPL. / for the menu, /exit to leave.")
    await repl.run()


if __name__ == "__main__":
    asyncio.run(main())
