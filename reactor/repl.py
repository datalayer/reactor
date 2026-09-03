# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""An extensible REPL, the way the reactor's CLI is an extensible CLI.

The reactor's ``reactor`` command is a Typer application plugins add commands
to; this module is the same idea for an *interactive* session. A host builds a
:class:`ReactorRepl` with a :class:`~reactor.slash.SlashCommandRegistry`,
plugins fill the registry — directly, or through the
:meth:`~reactor.hooks.ReactorHookSpecs.provide_slash_commands` hook — and the
REPL supplies what every interactive host otherwise rewrites:

- the **prompt loop** (``prompt_toolkit``, async, with sane EOF and Ctrl-C);
- the **slash menu** — type ``/`` and every registered command completes,
  with its description beside it; type past the name and the command's own
  argument choices complete, resolved live;
- **keyboard shortcuts** — a command's ``shortcut`` ("escape x" for Alt+X)
  becomes a binding that types and submits the command;
- **dispatch** — ``/name args`` finds the command by name or alias, runs its
  handler with the argument text, and hands any follow-up prompt back to the
  host's ``respond``.

What the REPL deliberately does not know is what a *prompt* is for. Anything
typed without a leading slash goes to ``respond`` — an agent, an interpreter,
an echo. The agent-runtimes terminal chat builds its Pydantic-AI-driven
session on this class; nothing here imports pydantic-ai, or ever should.

``prompt_toolkit`` is the one soft dependency, held behind an import guard so
the reactor core does not drag a terminal library into servers that never
prompt. Install it with the extra::

    pip install "datalayer_reactor[repl]"

@module reactor.repl
"""

from __future__ import annotations

import logging
from typing import Any, Awaitable, Callable, Optional

from .slash import SlashCommandRegistry, SlashCommandSpec

logger = logging.getLogger(__name__)

#: What the host does with input that is not a command — and with the
#: follow-up prompt a command returns. An agent, an interpreter, an echo.
Responder = Callable[[str], Awaitable[None]]

#: Prints a line to the person. Injected so a Rich host renders errors its own
#: way; the default is plain ``print``.
Printer = Callable[[str], None]


class ReplExit(Exception):
    """Raised by a command handler (or the host) to leave the loop."""


def _require_prompt_toolkit() -> Any:
    try:
        import prompt_toolkit  # noqa: F401

        return prompt_toolkit
    except ImportError as error:  # pragma: no cover - environment-dependent
        raise ImportError(
            "The reactor REPL needs prompt_toolkit. "
            'Install it with: pip install "datalayer_reactor[repl]"'
        ) from error


def build_completer(registry: SlashCommandRegistry) -> Any:
    """The slash menu, as a ``prompt_toolkit`` completer.

    Two stages, split on the first space. Before it, the menu offers the
    registered commands — primary names only, so an alias does not show the
    same command twice. After it, the *command's* declared arguments complete,
    and their choices may be callables resolved at the moment of asking — the
    servers actually configured, the models actually reachable — rather than
    a list frozen at import time.
    """
    _require_prompt_toolkit()
    from prompt_toolkit.completion import Completer, Completion
    from prompt_toolkit.formatted_text import HTML

    class SlashCommandCompleter(Completer):  # type: ignore[misc]
        def _argument_completions(self, text: str) -> Any:
            head, _, partial_arg = text[1:].partition(" ")
            command = registry.resolve(head)
            if command is None or not command.args:
                return

            # Complete the argument the cursor is on: everything before it is
            # settled.
            typed = partial_arg.split(" ")
            index = max(0, len(typed) - 1)
            current = typed[index].lower()
            if index >= len(command.args):
                return

            argument = command.args[index]
            for choice in argument.resolve_choices():
                if not choice.lower().startswith(current):
                    continue
                yield Completion(
                    text=choice,
                    start_position=-len(typed[index]),
                    display=HTML(f"<ansicyan>{choice}</ansicyan>"),
                    display_meta=HTML(
                        f"<ansibrightblack>{argument.name}</ansibrightblack>"
                    ),
                )

        def get_completions(self, document: Any, complete_event: Any) -> Any:
            text = document.text_before_cursor
            if not text.startswith("/"):
                return
            if " " in text:
                yield from self._argument_completions(text)
                return

            partial = text[1:].lower()
            for spec in registry:
                if not spec.name.startswith(partial):
                    continue
                description = spec.description
                if len(description) > 70:
                    description = description[:67] + "..."
                yield Completion(
                    text=f"/{spec.name}",
                    start_position=-len(text),
                    display=HTML(f"<ansicyan>/{spec.name}</ansicyan>"),
                    display_meta=HTML(
                        f"<ansibrightblack>{description}</ansibrightblack>"
                    ),
                )

    return SlashCommandCompleter()


def build_key_bindings(registry: SlashCommandRegistry) -> Any:
    """One binding per command ``shortcut``: it types the command and submits.

    A shortcut is spelled the ``prompt_toolkit`` way — ``"escape x"`` is
    Alt+X — and multi-key sequences are passed through as written.
    """
    _require_prompt_toolkit()
    from prompt_toolkit.key_binding import KeyBindings

    bindings = KeyBindings()
    taken: set[tuple[str, ...]] = set()

    def make_handler(name: str) -> Any:
        async def handler(event: Any) -> None:
            event.current_buffer.text = f"/{name}"
            event.current_buffer.validate_and_handle()

        return handler

    for spec in registry:
        if not spec.shortcut:
            continue
        keys = tuple(spec.shortcut.split())
        if keys in taken:
            logger.warning(
                "Shortcut %r is already bound; /%s keeps only its name",
                spec.shortcut,
                spec.name,
            )
            continue
        taken.add(keys)
        bindings.add(*keys)(make_handler(spec.name))

    return bindings


def _entry_points(group: str) -> tuple[Any, ...]:
    """Entry points for a group, tolerating an unreadable environment.

    A function of its own so a test can stand in for the environment — the
    seam the agent-runtimes discovery tests patch.
    """
    from importlib.metadata import entry_points

    try:
        return tuple(entry_points(group=group))
    except Exception as error:  # noqa: BLE001
        logger.debug("Entry points for %s could not be read: %s", group, error)
        return ()


def _resolve_plugin(loaded: Any) -> Any:
    """The implementation out of whatever an entry point resolved to.

    An entry point may name the implementation itself, a zero-argument
    factory for one, or a factory returning a ``(manifest, implementation)``
    pair — the reactor's own plugin convention.
    """
    if callable(loaded):
        loaded = loaded()
    if isinstance(loaded, tuple) and len(loaded) == 2:
        return loaded[1]
    return loaded


def discover_slash_commands(
    registry: SlashCommandRegistry,
    *,
    group: str,
) -> tuple[str, ...]:
    """Let every plugin installed under ``group`` register its commands.

    Each entry point resolves to a plugin whose ``provide_slash_commands``
    receives this registry — the rich one, aliases and argument choices and
    all. A plugin that fails costs a warning, never the session.

    Returns the names that contributed, for logging and a ``/help`` footer:
    somebody who installed a plugin should be able to see it was found.
    """
    contributed: list[str] = []
    for entry_point in _entry_points(group):
        name = getattr(entry_point, "name", "?")
        try:
            implementation = _resolve_plugin(entry_point.load())
            hook = getattr(implementation, "provide_slash_commands", None)
            if hook is None:
                logger.debug("Plugin %s provides no slash commands", name)
                continue
            hook(registry)
            contributed.append(name)
        except Exception as error:  # noqa: BLE001
            logger.warning(
                "The slash commands of plugin %s could not be registered: %s",
                name,
                error,
            )
    return tuple(contributed)


class ReactorRepl:
    """The interactive loop, with the registry as its vocabulary.

    A host constructs one, points it at what answers plain input, and runs
    it. Everything else — which commands exist, what they complete, what keys
    they answer to — comes from the registry, which is to say from plugins.

    ``prompt`` accepts ``prompt_toolkit`` HTML; the default is a plain
    chevron.
    """

    def __init__(
        self,
        registry: SlashCommandRegistry,
        *,
        respond: Optional[Responder] = None,
        prompt: str = "❯ ",
        printer: Optional[Printer] = None,
        style: Any = None,
    ) -> None:
        self.registry = registry
        self._respond = respond
        self._prompt = prompt
        self._printer: Printer = printer or (lambda line: print(line))
        self._style = style
        self._session: Any = None
        self._running = False

    # ── extension ─────────────────────────────────────────────────────

    def discover(self, group: str) -> tuple[str, ...]:
        """Let every plugin installed under ``group`` register its commands.

        Entry-point discovery, the same road the agent-runtimes terminal
        walks — so one plugin distribution serves both. A host holding a
        plugin object directly just calls its ``provide_slash_commands``
        with :attr:`registry`; there is nothing more to it.
        """
        return discover_slash_commands(self.registry, group=group)

    # ── the loop ──────────────────────────────────────────────────────

    def _ensure_session(self) -> Any:
        if self._session is not None:
            return self._session
        _require_prompt_toolkit()
        from prompt_toolkit import PromptSession
        from prompt_toolkit.cursor_shapes import CursorShape

        self._session = PromptSession(
            completer=build_completer(self.registry),
            key_bindings=build_key_bindings(self.registry),
            style=self._style,
            complete_while_typing=True,
            complete_in_thread=True,
            cursor=CursorShape.BLINKING_BLOCK,
        )
        return self._session

    async def read(self) -> str:
        """One line from the person, with the menu and the shortcuts live.

        EOF (Ctrl-D) reads as ``/exit`` — every REPL means "leave" by it, and
        a host that registered an ``/exit`` gets its own farewell; one that
        did not gets :class:`ReplExit` from dispatch. Ctrl-C clears the line
        rather than leaving: an interrupted thought is not a finished session.
        """
        from prompt_toolkit.formatted_text import HTML

        session = self._ensure_session()
        try:
            return (await session.prompt_async(HTML(self._prompt))).strip()
        except EOFError:
            return "/exit"
        except KeyboardInterrupt:
            return ""

    async def dispatch(self, line: str) -> bool:
        """Run one line. Returns whether it was handled as a command.

        ``/name args`` resolves by name or alias; the handler gets the
        argument text and may return a follow-up prompt, which goes to
        ``respond`` exactly as if the person had typed it — how a command
        like ``/suggestions`` turns a pick into a message. An unknown
        command is reported, not ignored: silence is how a typo reads as a
        hung agent.
        """
        if not line.startswith("/"):
            return False

        head, _, argv = line[1:].partition(" ")
        name = head.strip().lower()
        if not name:
            return True
        spec = self.registry.resolve(name)
        if spec is None:
            self._printer(f"Unknown command: /{name}")
            self._printer("/help lists what there is.")
            return True
        follow_up = None
        if spec.handler is not None:
            follow_up = await spec.handler(argv.strip())
        if follow_up and self._respond is not None:
            await self._respond(follow_up)
        return True

    async def run(self) -> None:
        """Read, dispatch, respond — until something raises :class:`ReplExit`."""
        self._running = True
        try:
            while self._running:
                line = await self.read()
                if not line:
                    continue
                try:
                    if await self.dispatch(line):
                        continue
                except ReplExit:
                    break
                if self._respond is not None:
                    await self._respond(line)
        finally:
            self._running = False

    def stop(self) -> None:
        """End the loop after the current turn."""
        self._running = False


__all__ = [
    "ReactorRepl",
    "discover_slash_commands",
    "ReplExit",
    "Responder",
    "build_completer",
    "build_key_bindings",
    "SlashCommandRegistry",
    "SlashCommandSpec",
]
