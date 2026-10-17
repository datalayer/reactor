# Copyright (c) 2026-Present Datalayer, Inc.
#
# BSD 3-Clause License

"""Display types: declared once in Python, drawn by whichever renderer claims them.

``@display_type`` names a :class:`~reactor.ui.wire.Display` subclass with a
MIME-like type and a version, and records it, so a host can turn a wire
display back into its class and publish every type's schema.

The audience of a field is said where the field is declared, and applied
once, here, at the wire boundary:

- ``both`` (the default): the page draws it and a model may read it.
- ``page``: the person sees it; :func:`model_view` leaves it out.
- ``SecretStr`` / ``SecretBytes``: neither view carries it. A secret typed on
  the page reaches its action handler and nothing else.

::

    class Weather(Display):
        city: str
        note: Annotated[str, audience("page")] = ""
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Literal, TypeVar, Union, get_args, get_origin

from pydantic import BaseModel, SecretBytes, SecretStr
from pydantic_core import to_jsonable_python

from .wire import Display, DisplayWire

D = TypeVar("D", bound=type[Display])

#: ``top/sub`` with the characters a media type allows, e.g.
#: ``application/vnd.datalayer.pap.sign-in+json``.
_MEDIA_TYPE = re.compile(r"^[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*$")


@dataclass(frozen=True)
class Audience:
    """Who a field is for. Put it in ``Annotated[...]`` with :func:`audience`."""

    value: Literal["both", "page"]


def audience(value: Literal["both", "page"]) -> Audience:
    """Mark a field for ``both`` the page and the model, or the ``page`` only."""
    if value not in ("both", "page"):
        raise ValueError(f"An audience is 'both' or 'page', not {value!r}")
    return Audience(value)


def _is_secret(annotation: Any) -> bool:
    if annotation in (SecretStr, SecretBytes):
        return True
    if get_origin(annotation) is Union or type(annotation).__name__ == "UnionType":
        return any(_is_secret(argument) for argument in get_args(annotation))
    return False


def _audience_of(metadata: Iterable[Any]) -> str:
    for item in metadata:
        if isinstance(item, Audience):
            return item.value
    return "both"


def _view(value: Any, *, for_model: bool) -> Any:
    if isinstance(value, BaseModel):
        return _fields(value, for_model=for_model, exclude=frozenset())
    if isinstance(value, (SecretStr, SecretBytes)):
        # A secret nested in a container the annotation did not name.
        return None
    if isinstance(value, dict):
        return {key: _view(item, for_model=for_model) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_view(item, for_model=for_model) for item in value]
    return to_jsonable_python(value)


def _fields(model: BaseModel, *, for_model: bool, exclude: frozenset[str]) -> dict[str, Any]:
    view: dict[str, Any] = {}
    for name, field in type(model).model_fields.items():
        if name in exclude or _is_secret(field.annotation):
            continue
        if for_model and _audience_of(field.metadata) == "page":
            continue
        view[name] = _view(getattr(model, name), for_model=for_model)
    return view


def page_view(model: BaseModel, *, exclude: Iterable[str] = ()) -> dict[str, Any]:
    """A model's fields as the page receives them: everything but secrets."""
    return _fields(model, for_model=False, exclude=frozenset(exclude))


def model_view(model: BaseModel, *, exclude: Iterable[str] = ()) -> dict[str, Any]:
    """A model's fields as a model may read them: no ``page`` fields, no secrets.

    For displays and for action payloads alike: what a person typed on the page
    reaches the model through this, or not at all.
    """
    return _fields(model, for_model=True, exclude=frozenset(exclude))


class DisplayRegistry:
    """Display classes by type and version."""

    def __init__(self) -> None:
        self._classes: dict[tuple[str, int], type[Display]] = {}

    def register(self, cls: type[Display]) -> type[Display]:
        """Record a decorated class. The same class twice is a no-op; another class
        under a taken type and version is refused."""
        if not cls.display_type:
            raise TypeError(f"{cls.__name__} has no display type: decorate it with @display_type")
        key = (cls.display_type, cls.display_version)
        taken = self._classes.get(key)
        if taken is not None and taken is not cls:
            raise ValueError(
                f"{cls.display_type} v{cls.display_version} is already "
                f"{taken.__module__}.{taken.__qualname__}"
            )
        self._classes[key] = cls
        return cls

    def merge(self, other: "DisplayRegistry") -> None:
        """Take every class of another registry, or none: one conflict refuses them all."""
        for key, cls in other._classes.items():
            taken = self._classes.get(key)
            if taken is not None and taken is not cls:
                raise ValueError(f"{key[0]} v{key[1]} is already {taken.__module__}.{taken.__qualname__}")
        self._classes.update(other._classes)

    def get(self, display_type: str, version: int | None = None) -> type[Display] | None:
        """The class of a type: this version, or the latest when none is asked."""
        if version is not None:
            return self._classes.get((display_type, version))
        versions = [v for (t, v) in self._classes if t == display_type]
        return self._classes[(display_type, max(versions))] if versions else None

    def parse(self, wire: DisplayWire | dict[str, Any]) -> Display:
        """A wire display back as its class. An unknown type is a ``LookupError``."""
        received = wire if isinstance(wire, DisplayWire) else DisplayWire.model_validate(wire)
        cls = self.get(received.type, received.version)
        if cls is None:
            raise LookupError(f"No display type {received.type} v{received.version} is registered")
        return cls.from_wire(received)

    def types(self) -> list[tuple[str, int]]:
        """Every registered type and version, sorted."""
        return sorted(self._classes)

    def schemas(self) -> dict[str, dict[str, Any]]:
        """Each type's JSON Schema, keyed ``type@version``."""
        return {
            f"{display_type}@{version}": cls.model_json_schema()
            for (display_type, version), cls in sorted(self._classes.items())
        }


#: Every class ``@display_type`` has decorated in this process.
DISPLAY_TYPES = DisplayRegistry()


def display_type(type_: str, *, version: int = 1) -> Callable[[D], D]:
    """Name a :class:`~reactor.ui.wire.Display` subclass and record it.

    ::

        @display_type("application/vnd.datalayer.pap.sign-in+json", version=1)
        class PapSignIn(Display): ...
    """
    if not _MEDIA_TYPE.match(type_):
        raise ValueError(f"A display type is a media type like 'application/vnd.x+json', not {type_!r}")
    if version < 1:
        raise ValueError(f"A display version starts at 1, not {version}")

    def decorate(cls: D) -> D:
        if not (isinstance(cls, type) and issubclass(cls, Display)):
            raise TypeError(f"@display_type decorates Display subclasses, not {cls!r}")
        if cls.text is Display.text:
            raise TypeError(f"{cls.__name__} must say what it reads as: define text()")
        cls.display_type = type_
        cls.display_version = version
        DISPLAY_TYPES.register(cls)
        return cls

    return decorate


__all__ = [
    "Audience",
    "DISPLAY_TYPES",
    "DisplayRegistry",
    "audience",
    "display_type",
    "model_view",
    "page_view",
]
