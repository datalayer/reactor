# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Where ops go: a channel is anything that can ``emit`` one.

The reactor does not say how ops reach the page — an AG-UI stream
(:mod:`reactor.ui.agui`), a websocket, a server-sent event per op. A host
implements :class:`UiChannel` over its transport; producers only ever call
``emit``. :class:`MemoryUiChannel` keeps what it was given, for tests and for
a host that replays a session.
"""

from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from pydantic import TypeAdapter

from .wire import (
    AppendBody,
    AppendOp,
    AskOp,
    Display,
    MetaOp,
    PatchOp,
    PatchOperation,
    RemoveOp,
    ShowOp,
    StateOp,
    UiOp,
    WindowBody,
    WindowOp,
)

_OP = TypeAdapter(UiOp)


def parse_op(value: UiOp | dict[str, Any]) -> UiOp:
    """An op from its JSON form, checked; an op passes through."""
    if isinstance(value, dict):
        return _OP.validate_python(value)
    return value


@runtime_checkable
class UiChannel(Protocol):
    """Anything ops can be emitted to."""

    def emit(self, op: UiOp) -> None: ...


class MemoryUiChannel:
    """A channel that keeps every op, in order."""

    def __init__(self) -> None:
        self.ops: list[UiOp] = []

    def emit(self, op: UiOp | dict[str, Any]) -> None:
        self.ops.append(parse_op(op))

    def for_scope(self, scope: str) -> list[UiOp]:
        return [op for op in self.ops if op.scope == scope]

    def dump(self) -> list[dict[str, Any]]:
        """The ops as JSON, as a transport would send them."""
        return [_OP.dump_python(op, mode="json", by_alias=True) for op in self.ops]


def show(channel: UiChannel, scope: str, display: Display) -> None:
    channel.emit(ShowOp(scope=scope, id=display.id, body=display.wire()))


def ask(channel: UiChannel, scope: str, display: Display) -> None:
    channel.emit(AskOp(scope=scope, id=display.id, body=display.wire()))


def patch(channel: UiChannel, scope: str, display_id: str, operations: list[PatchOperation | dict[str, Any]]) -> None:
    channel.emit(
        PatchOp(scope=scope, id=display_id, body=[PatchOperation.model_validate(o) for o in operations])
    )


def append(channel: UiChannel, scope: str, display_id: str, path: str, value: Any) -> None:
    channel.emit(AppendOp(scope=scope, id=display_id, body=AppendBody(path=path, value=value)))


def remove(channel: UiChannel, scope: str, display_id: str) -> None:
    channel.emit(RemoveOp(scope=scope, id=display_id))


def state(channel: UiChannel, scope: str, operations: list[PatchOperation | dict[str, Any]]) -> None:
    channel.emit(StateOp(scope=scope, body=[PatchOperation.model_validate(o) for o in operations]))


def window(channel: UiChannel, scope: str, name: str, **args: Any) -> None:
    channel.emit(WindowOp(scope=scope, body=WindowBody(name=name, args=args)))


def meta(channel: UiChannel, scope: str, **facts: Any) -> None:
    channel.emit(MetaOp(scope=scope, body=facts))


__all__ = [
    "MemoryUiChannel",
    "UiChannel",
    "append",
    "ask",
    "meta",
    "parse_op",
    "patch",
    "remove",
    "show",
    "state",
    "window",
]
