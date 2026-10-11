# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""The wire contract between a Python host and the page that draws it.

One envelope carries everything a server tells a page about what to show:

``{"v": 1, "op": ..., "scope": ..., "id": ..., "body": ...}``

``op`` is one of eight verbs, and the body's shape follows from it:

``show``
    A display appears, or replaces the one of the same id. The body is the
    display.
``patch``
    RFC 6902 operations against one display (``/text``, ``/data/...``).
``append``
    One value pushed onto an array inside one display — a streamed list.
``remove``
    One display goes. No body.
``state``
    RFC 6902 operations against the scope's shared state.
``ask``
    A display that is a question: drawn like ``show``, and remembered as
    waiting for an answer.
``window``
    A message for the host window the page lives in (open, focus, notify).
    Not state: the page acts on it and keeps nothing.
``meta``
    Facts about the scope (a title, an author), merged.

``scope`` is what the ops belong to — a session, a thread — so one stream
can carry several. ``id`` names the display an op is about.

A **display** is a typed payload with a MIME-like ``type``, a ``version``, and
a ``text`` every display must have: the fallback a page with no renderer for
the type shows, and the line a log or a transcript keeps. Python declares
displays as pydantic classes (:mod:`reactor.ui.display`); on the wire their
fields travel as ``data``.

What travels back is a :class:`UiAction`: the page pressing something a
display offered, carrying the token the server minted when it offered it
(:mod:`reactor.ui.actions`).

These models are the canonical definition. ``schema/reactor-ui.v1.schema.json``
is generated from them (:mod:`reactor.ui.schema`) and the TypeScript types in
``@datalayer/reactor/ui`` follow the schema; a drift test on each side keeps
the three in step.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Any, ClassVar, Literal, Union

from pydantic import BaseModel, ConfigDict, Field

#: The envelope version every op carries. A change to the wire is a new one.
UI_WIRE_VERSION = 1

#: The verbs of the envelope.
UiOpName = Literal["show", "patch", "append", "remove", "state", "ask", "window", "meta"]


class _Wire(BaseModel):
    """Strict on the way in: a field nobody declared is a bug on the other side."""

    model_config = ConfigDict(extra="forbid")


class _PatchWire(_Wire):
    model_config = ConfigDict(extra="forbid", populate_by_name=True)

    path: str


class PatchAdd(_PatchWire):
    """RFC 6902 ``add``. ``value`` must be there; ``null`` is a value."""

    op: Literal["add"]
    value: Any


class PatchRemove(_PatchWire):
    """RFC 6902 ``remove``: the path, nothing else."""

    op: Literal["remove"]


class PatchReplace(_PatchWire):
    """RFC 6902 ``replace``. ``value`` must be there; ``null`` is a value."""

    op: Literal["replace"]
    value: Any


class PatchMove(_PatchWire):
    """RFC 6902 ``move``, from ``from`` to ``path``."""

    op: Literal["move"]
    from_: str = Field(alias="from")


class PatchCopy(_PatchWire):
    """RFC 6902 ``copy``, from ``from`` to ``path``."""

    op: Literal["copy"]
    from_: str = Field(alias="from")


class PatchTest(_PatchWire):
    """RFC 6902 ``test``. ``value`` must be there; ``null`` is a value."""

    op: Literal["test"]
    value: Any


#: One RFC 6902 operation, told apart by ``op``, each with the members it needs.
PatchOperation = Annotated[
    Union[PatchAdd, PatchRemove, PatchReplace, PatchMove, PatchCopy, PatchTest],
    Field(discriminator="op"),
]


class ActionOffer(_Wire):
    """Something a display lets the page press.

    ``token`` is minted by the server for this display, this session and this
    action (:meth:`reactor.ui.actions.ActionRegistry.offer`): only what was
    offered can be pressed.
    """

    name: str
    label: str | None = None
    token: str


class FileRef(_Wire):
    """A file by reference: uploaded, or offered for download.

    Files never ride inside JSON. ``ref`` is the host's handle on the bytes;
    ``url`` is where the page may fetch them, signed and short-lived when it is
    there at all.
    """

    ref: str
    name: str
    media_type: str
    size: int | None = None
    url: str | None = None


class DisplayWire(_Wire):
    """A display as it travels: the shape a renderer receives."""

    type: str
    version: int = 1
    id: str
    text: str
    data: dict[str, Any] = Field(default_factory=dict)
    actions: list[ActionOffer] = Field(default_factory=list)


class AppendBody(_Wire):
    """What an ``append`` pushes, and onto which array of the display."""

    path: str
    value: Any = None


class WindowBody(_Wire):
    """A message for the host window: a name, and its arguments."""

    name: str
    args: dict[str, Any] = Field(default_factory=dict)


class _Op(_Wire):
    v: Literal[1] = UI_WIRE_VERSION
    scope: str
    id: str | None = None


class ShowOp(_Op):
    op: Literal["show"] = "show"
    body: DisplayWire


class PatchOp(_Op):
    op: Literal["patch"] = "patch"
    id: str
    body: list[PatchOperation]


class AppendOp(_Op):
    op: Literal["append"] = "append"
    id: str
    body: AppendBody


class RemoveOp(_Op):
    op: Literal["remove"] = "remove"
    id: str
    body: None = None


class StateOp(_Op):
    op: Literal["state"] = "state"
    body: list[PatchOperation]


class AskOp(_Op):
    op: Literal["ask"] = "ask"
    body: DisplayWire


class WindowOp(_Op):
    op: Literal["window"] = "window"
    body: WindowBody


class MetaOp(_Op):
    op: Literal["meta"] = "meta"
    body: dict[str, Any]


#: One op of the envelope, told apart by ``op``.
UiOp = Annotated[
    Union[ShowOp, PatchOp, AppendOp, RemoveOp, StateOp, AskOp, WindowOp, MetaOp],
    Field(discriminator="op"),
]


class UiAction(_Wire):
    """The page pressing something a display offered.

    ``idempotency_id`` is the page's own id for the press: a retry carries the
    same one and gets the first answer instead of a second run.
    """

    action: str
    display_id: str
    token: str
    payload: dict[str, Any] = Field(default_factory=dict)
    idempotency_id: str | None = None


class Display(BaseModel):
    """A typed display: subclass it, declare fields, say what it reads as.

    ::

        @display_type("application/vnd.example.weather+json", version=1)
        class Weather(Display):
            city: str
            celsius: float

            def text(self) -> str:
                return f"{self.city}: {self.celsius} °C"

    The subclass's own fields are the display's ``data``; ``id`` and
    ``actions`` are the envelope's. :meth:`text` is mandatory — it is what a
    page without a renderer shows, and what a transcript keeps.

    Fields carry an audience (:func:`reactor.ui.display.audience`): ``both``
    by default, ``page`` for what the person sees and the model must not.
    ``SecretStr`` fields never leave the server in either view.
    """

    model_config = ConfigDict(extra="forbid")

    #: Set by :func:`reactor.ui.display.display_type`.
    display_type: ClassVar[str] = ""
    display_version: ClassVar[int] = 1

    id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    actions: list[ActionOffer] = Field(default_factory=list)

    #: The envelope's fields, never part of ``data``.
    _ENVELOPE: ClassVar[frozenset[str]] = frozenset({"id", "actions"})

    def text(self) -> str:
        """What this display reads as without a renderer. Mandatory."""
        raise NotImplementedError(f"{type(self).__name__} must say what it reads as: define text()")

    def wire(self) -> DisplayWire:
        """The display as the page receives it."""
        from .display import page_view

        if not self.display_type:
            raise TypeError(f"{type(self).__name__} has no display type: decorate it with @display_type")
        return DisplayWire(
            type=self.display_type,
            version=self.display_version,
            id=self.id,
            text=self.text(),
            data=page_view(self, exclude=self._ENVELOPE),
            actions=list(self.actions),
        )

    def model_view(self) -> dict[str, Any]:
        """What a model is told about this display: its text, and its ``both`` fields."""
        from .display import model_view

        return {
            "type": self.display_type,
            "text": self.text(),
            "data": model_view(self, exclude=self._ENVELOPE),
        }

    @classmethod
    def from_wire(cls, wire: DisplayWire | dict[str, Any]) -> "Display":
        """This class's display back from its wire form."""
        received = wire if isinstance(wire, DisplayWire) else DisplayWire.model_validate(wire)
        if received.type != cls.display_type or received.version != cls.display_version:
            raise ValueError(
                f"{received.type} v{received.version} is not "
                f"{cls.display_type} v{cls.display_version}"
            )
        return cls.model_validate({**received.data, "id": received.id, "actions": received.actions})


__all__ = [
    "UI_WIRE_VERSION",
    "ActionOffer",
    "AppendBody",
    "AppendOp",
    "AskOp",
    "Display",
    "DisplayWire",
    "FileRef",
    "MetaOp",
    "PatchAdd",
    "PatchCopy",
    "PatchMove",
    "PatchOp",
    "PatchOperation",
    "PatchRemove",
    "PatchReplace",
    "PatchTest",
    "RemoveOp",
    "ShowOp",
    "StateOp",
    "UiAction",
    "UiOp",
    "UiOpName",
    "WindowBody",
    "WindowOp",
]
