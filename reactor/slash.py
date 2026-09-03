# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""The slash command registry — the REPL's half of the command story.

:class:`~reactor.commands.CommandRegistry` is the palette's registry: flat
ids, invoked by a host that does not interpret them. A *slash* command is the
conversational twin — typed with a leading ``/``, carrying aliases, a
``/help`` group, arguments with completable choices, and a handler that may
answer with a follow-up prompt. Both exist because their surfaces genuinely
differ; a REPL prompt completes ``/mo`` into ``/models``, a palette fuzzy
matches labels.

:class:`SlashCommandSpec` is the Python mirror of the TypeScript
``CommandContribution`` in the LOOP workspace, so a command is described the
same way in the terminal and in the browser even when the two implementations
differ — a Rich panel there, a React panel here.

Grown out of ``agent_runtimes.loop.commands`` and moved here unchanged in
shape: the registry was never about agents, and the REPL that consumes it
(:mod:`reactor.repl`) knows nothing about what a host does with a prompt.

Plugins reach it through the
:meth:`~reactor.hooks.ReactorHookSpecs.provide_slash_commands` hook: the host
passes this registry, the plugin registers what it ships.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Iterator, Optional, Sequence

logger = logging.getLogger(__name__)

#: A handler takes the text after the command name and may return a
#: follow-up prompt for the host to send on its behalf.
CommandHandler = Callable[[str], Awaitable[Optional[str]]]


class CommandCollisionError(ValueError):
    """Raised when a command name or alias is already taken."""


@dataclass(frozen=True)
class CommandArgSpec:
    """One argument of a slash command, used to drive completion.

    ``choices`` may be a callable so a command can complete against live state
    — the MCP servers currently configured, the models actually reachable —
    rather than a list frozen at import time.
    """

    name: str
    description: str = ""
    required: bool = False
    choices: Sequence[str] | Callable[[], Sequence[str]] = ()

    def resolve_choices(self) -> tuple[str, ...]:
        """Current values for this argument, never raising at the prompt."""
        source = self.choices
        if callable(source):
            try:
                source = source()
            except Exception as error:  # noqa: BLE001
                logger.debug("Choices for %s could not be resolved: %s", self.name, error)
                return ()
        return tuple(str(choice) for choice in source or ())


@dataclass
class SlashCommandSpec:
    """A slash command, however it was contributed."""

    name: str
    description: str = ""
    aliases: tuple[str, ...] = ()
    shortcut: Optional[str] = None
    #: Grouping for `/help`. Commands with no group land under "General".
    group: str = "General"
    args: tuple[CommandArgSpec, ...] = ()
    handler: Optional[CommandHandler] = None
    #: Where it came from — "builtin" or a plugin name. Shown when a collision
    #: is refused, so the culprit is named rather than guessed at.
    source: str = "builtin"

    @property
    def names(self) -> tuple[str, ...]:
        """The primary name and every alias."""
        return (self.name, *self.aliases)


@dataclass
class SlashCommandRegistry:
    """Every slash command available in a session, by name and by alias."""

    _by_name: dict[str, SlashCommandSpec] = field(default_factory=dict)
    _primary: dict[str, SlashCommandSpec] = field(default_factory=dict)

    def register(self, spec: SlashCommandSpec) -> SlashCommandSpec:
        """Register a command, refusing to shadow an existing name.

        Raises :class:`CommandCollisionError` on any collision. Callers that
        must not bring the session down over one bad plugin should use
        :meth:`try_register`.
        """
        for name in spec.names:
            existing = self._by_name.get(name)
            if existing is not None:
                raise CommandCollisionError(
                    f"/{name} is already registered by {existing.source!r}; "
                    f"{spec.source!r} cannot take it"
                )
        for name in spec.names:
            self._by_name[name] = spec
        self._primary[spec.name] = spec
        return spec

    def try_register(self, spec: SlashCommandSpec) -> bool:
        """Register a command, logging and skipping on collision.

        The posture for anything discovered rather than shipped: a third-party
        command that clashes with `/help` costs a warning, not a CLI that
        refuses to start.
        """
        try:
            self.register(spec)
        except CommandCollisionError as error:
            logger.warning("Slash command not registered: %s", error)
            return False
        return True

    def resolve(self, name: str) -> Optional[SlashCommandSpec]:
        """Look a command up by primary name or alias, with or without a slash."""
        return self._by_name.get(name.lstrip("/").strip().lower())

    def __contains__(self, name: object) -> bool:
        return isinstance(name, str) and self.resolve(name) is not None

    def __iter__(self) -> Iterator[SlashCommandSpec]:
        """Primary commands, alphabetically — aliases are not yielded twice."""
        return iter(sorted(self._primary.values(), key=lambda spec: spec.name))

    def __len__(self) -> int:
        return len(self._primary)

    def names(self) -> tuple[str, ...]:
        """Every primary command name."""
        return tuple(sorted(self._primary))

    def by_group(self) -> dict[str, list[SlashCommandSpec]]:
        """Primary commands grouped for `/help`, groups alphabetical."""
        grouped: dict[str, list[SlashCommandSpec]] = {}
        for spec in self:
            grouped.setdefault(spec.group or "General", []).append(spec)
        return {group: grouped[group] for group in sorted(grouped)}

    def as_mapping(self) -> dict[str, SlashCommandSpec]:
        """Name-and-alias mapping, the shape the terminal UI consumes."""
        return dict(self._by_name)


def spec_from_module(
    module: Any,
    handler: CommandHandler,
    *,
    source: str = "builtin",
) -> SlashCommandSpec:
    """Build a spec from a command module.

    The convention: a command module exports ``NAME``, ``ALIASES``,
    ``DESCRIPTION`` and ``SHORTCUT``, with ``GROUP`` and ``ARGS`` as optional
    additions. The handler is passed separately, because binding it usually
    needs the host (a session, a console) the module should not import.
    """
    return SlashCommandSpec(
        name=module.NAME,
        description=getattr(module, "DESCRIPTION", ""),
        aliases=tuple(getattr(module, "ALIASES", ()) or ()),
        shortcut=getattr(module, "SHORTCUT", None),
        group=getattr(module, "GROUP", "General"),
        args=tuple(getattr(module, "ARGS", ()) or ()),
        handler=handler,
        source=source,
    )
