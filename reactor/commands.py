# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""The command registry, on the Python side.

The mirror of ``@datalayer/reactor``'s ``core/commands``. A command is a named
thing somebody can invoke — from a palette in the browser, a prompt in a
terminal, a chat message, an HTTP call. Plugins register them; the host decides
how they are reached, and the reactor knows about no surface at all.

Why a registry rather than a contribution point, here as in TypeScript: a
contribution is data the host reads and interprets, while a command is
*behaviour the host invokes without interpreting it*. Every host would
otherwise reimplement looking one up, running it, and dropping the ones whose
plugin went away — and would each get the error handling slightly wrong.

The plugin-facing hook is :meth:`~reactor.hooks.ReactorHookSpecs.provide_slash_commands`:
the host passes this registry, the plugin calls :meth:`CommandRegistry.register`.
"""

from __future__ import annotations

import inspect
import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Optional

logger = logging.getLogger(__name__)

#: Undoes one registration. Idempotent.
Dispose = Callable[[], None]

#: What a command does. May be a coroutine function; may take an argument.
CommandHandler = Callable[..., Any]


@dataclass(frozen=True)
class Command:
    """Something a person can invoke.

    Presentation sits beside behaviour on purpose: a palette needs a label, an
    icon and a description *before* anything runs, and a command carrying only
    a callable forces every surface to keep a parallel table of labels — which
    then drifts from the commands themselves.
    """

    #: Stable, unique identity — ``music.play_random``, not "Play a random song".
    #: Namespaced by convention, because ids collide across plugins that never
    #: heard of each other.
    id: str
    #: What a person reads in a palette or a menu.
    name: str
    #: Do the thing. Sync or async; see :meth:`CommandRegistry.execute`.
    execute: CommandHandler
    #: One line, shown beside the name where there is room for it.
    description: str = ""
    #: An Octicon name, for surfaces that draw icons.
    octicon: str = ""
    #: For surfaces that would rather show an emoji, or have no icon set.
    emoji: str = ""
    #: Groups related commands. Free text: the reactor never interprets it.
    category: str = ""
    #: How to reach this without the palette, as text to display. Documentation,
    #: not a binding — nothing here listens to a keyboard.
    keybinding: str = ""
    #: Lower sorts first. Ties keep registration order.
    order: int = 0
    #: Whether the command can run right now. ``None`` means always. A command
    #: that cannot run is still *listed*: telling somebody why they cannot do
    #: something beats pretending the feature was never there.
    is_enabled: Optional[Callable[[], bool]] = None

    def describe(self) -> dict[str, Any]:
        """The command as JSON, for a host that serves it over HTTP.

        Everything except the callables — which is the whole point of keeping
        presentation on the command: a browser can draw the palette without the
        server explaining each entry.
        """
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "octicon": self.octicon,
            "emoji": self.emoji,
            "category": self.category,
            "keybinding": self.keybinding,
            "order": self.order,
            "enabled": self.enabled,
        }

    @property
    def enabled(self) -> bool:
        """Whether it can run right now. A predicate that raises means no."""
        if self.is_enabled is None:
            return True
        try:
            return bool(self.is_enabled())
        except Exception:
            logger.exception("Command %s: is_enabled raised; treating as unavailable", self.id)
            return False


@dataclass
class _Stored:
    """A registration: the command, its owner, and its arrival order."""

    plugin: str
    seq: int
    command: Command


class CommandRegistry:
    """Commands registered by plugins, and a way to run them.

    One instance lives on the platform. Plugins reach it through
    ``provide_slash_commands``, so a command goes away with the plugin that
    registered it without the plugin arranging anything.
    """

    def __init__(self) -> None:
        self._by_id: dict[str, _Stored] = {}
        self._by_plugin: dict[str, list[str]] = {}
        self._seq = 0

    def register(self, plugin: str, command: Command) -> Dispose:
        """Register a command and return its disposer.

        The disposer is idempotent, and is also run when the registering plugin
        is unregistered or disabled — so the ordinary case needs no disposer.

        :raises ValueError: if ``command.id`` is already registered. Two plugins
            fighting over one id is a bug, and the loser would otherwise fail
            invisibly.
        """
        if not command.id:
            raise ValueError("A command needs an id")
        existing = self._by_id.get(command.id)
        if existing is not None:
            raise ValueError(
                f"Command '{command.id}' is already registered by plugin "
                f"'{existing.plugin}'. Command ids must be unique; namespace "
                f"them with the plugin they belong to."
            )

        entry = _Stored(plugin=plugin, seq=self._seq, command=command)
        self._seq += 1
        self._by_id[command.id] = entry
        self._by_plugin.setdefault(plugin, []).append(command.id)

        disposed = False

        def dispose() -> None:
            nonlocal disposed
            if disposed:
                return
            disposed = True
            # Only if it is still *this* entry: a later registration of the same
            # id must not be removed by a stale disposer.
            if self._by_id.get(command.id) is entry:
                del self._by_id[command.id]
            owned = self._by_plugin.get(plugin)
            if owned and command.id in owned:
                owned.remove(command.id)

        return dispose

    def get(self, command_id: str) -> Command | None:
        """One command by id, or ``None``."""
        entry = self._by_id.get(command_id)
        return entry.command if entry else None

    def list(self, plugin: str | None = None) -> list[Command]:
        """Every command, ordered by ``order`` then registration order.

        Pass *plugin* to see only what one plugin registered.
        """
        entries = [e for e in self._by_id.values() if plugin is None or e.plugin == plugin]
        entries.sort(key=lambda e: (e.command.order, e.seq))
        return [e.command for e in entries]

    def owner(self, command_id: str) -> str | None:
        """Which plugin registered a command — for hosts, and for debugging."""
        entry = self._by_id.get(command_id)
        return entry.plugin if entry else None

    def describe(self) -> list[dict[str, Any]]:
        """Every command as JSON, each carrying the plugin that registered it."""
        entries = sorted(self._by_id.values(), key=lambda e: (e.command.order, e.seq))
        return [{**e.command.describe(), "plugin": e.plugin} for e in entries]

    async def execute(self, command_id: str, argument: Any = None) -> Any:
        """Run a command by id, and return whatever it returns.

        Always awaitable, even for a synchronous command, so a caller never has
        to ask which kind it invoked. A command that raises propagates here
        rather than taking down the surface that invoked it — the caller decides
        what a failed command looks like, because only it knows where to say so.

        A handler that takes no parameter is called with none, so the common
        command does not have to accept an argument it ignores.

        :raises KeyError: if no such command is registered.
        :raises RuntimeError: if the command is currently unavailable.
        """
        entry = self._by_id.get(command_id)
        if entry is None:
            raise KeyError(f"No command '{command_id}' is registered")
        command = entry.command
        if not command.enabled:
            raise RuntimeError(f"Command '{command_id}' is not available right now")

        handler = command.execute
        try:
            takes_argument = bool(inspect.signature(handler).parameters)
        except (TypeError, ValueError):
            # A builtin or C callable whose signature cannot be read: pass the
            # argument only when there is one to pass.
            takes_argument = argument is not None

        result = handler(argument) if takes_argument else handler()
        if inspect.isawaitable(result):
            return await result
        return result

    def dispose_plugin(self, plugin: str) -> None:
        """Drop every command one plugin registered (on unregister, disable)."""
        for command_id in list(self._by_plugin.get(plugin, [])):
            entry = self._by_id.get(command_id)
            if entry is not None and entry.plugin == plugin:
                del self._by_id[command_id]
        self._by_plugin.pop(plugin, None)


@dataclass
class PluginCommands:
    """The registry as one plugin sees it: its own registrations, no others'.

    Handed to ``provide_slash_commands`` so a plugin never names itself when
    registering — the same shape as ``PluginContributions``, and for the same
    reason: a plugin that has to repeat its own name will eventually repeat
    somebody else's.
    """

    registry: CommandRegistry
    plugin: str
    _disposers: list[Dispose] = field(default_factory=list)

    def register(self, command: Command) -> Dispose:
        """Register one command on behalf of this plugin."""
        dispose = self.registry.register(self.plugin, command)
        self._disposers.append(dispose)
        return dispose

    def add(
        self,
        command_id: str,
        name: str,
        execute: CommandHandler,
        **presentation: Any,
    ) -> Dispose:
        """Register a command without building the :class:`Command` first.

        ``commands.add("music.play", "Play", play, emoji="▶️")`` — the shorthand
        for the common case, where the command is a callable and a label.
        """
        return self.register(Command(id=command_id, name=name, execute=execute, **presentation))

    def dispose(self) -> None:
        """Undo everything this plugin registered."""
        for dispose in list(self._disposers):
            dispose()
        self._disposers.clear()
