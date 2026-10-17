# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""The wire models as JSON Schema: what the TypeScript types are checked against.

``schema/reactor-ui.v1.schema.json`` is this module's output, committed. A
test regenerates it and compares, so a model changed without the schema fails
here; the TypeScript drift test reads the same file, so the types cannot
quietly fall behind either. Regenerate with::

    reactor ui schema --out schema/reactor-ui.v1.schema.json
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from pydantic import TypeAdapter
from pydantic.json_schema import models_json_schema

from .wire import (
    UI_WIRE_VERSION,
    DisplayWire,
    DownFrame,
    FileRef,
    UiAction,
    UiOp,
    UpFrame,
)

SCHEMA_ID = f"https://reactor.datalayer.tech/schema/reactor-ui.v{UI_WIRE_VERSION}.schema.json"

#: Where the committed copy lives, from the repository root.
SCHEMA_PATH = Path("schema") / f"reactor-ui.v{UI_WIRE_VERSION}.schema.json"

_REF = "#/$defs/{model}"


def ui_wire_schema() -> dict[str, Any]:
    """The whole wire: every op, the display, the action, the file reference,
    and the socket's frames each way (``UpFrame``, ``DownFrame``)."""
    op = TypeAdapter(UiOp).json_schema(ref_template=_REF)
    defs: dict[str, Any] = dict(op.pop("$defs", {}))
    for name, frames in (("UpFrame", UpFrame), ("DownFrame", DownFrame)):
        frame = TypeAdapter(frames).json_schema(ref_template=_REF)
        defs.update(frame.pop("$defs", {}))
        defs[name] = frame
    _, models = models_json_schema(
        [
            (DisplayWire, "validation"),
            (UiAction, "validation"),
            (FileRef, "validation"),
        ],
        ref_template=_REF,
    )
    defs.update(models.get("$defs", {}))
    defs["UiOp"] = op
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": SCHEMA_ID,
        "title": f"Reactor UI wire, v{UI_WIRE_VERSION}",
        "description": "One op of the envelope a host emits to the page. UiAction is what the page sends back.",
        "$ref": "#/$defs/UiOp",
        "$defs": dict(sorted(defs.items())),
    }


def render_schema() -> str:
    """The schema as the committed file holds it."""
    return json.dumps(ui_wire_schema(), indent=2, sort_keys=True) + "\n"


def write_schema(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_schema())
    return path


__all__ = [
    "SCHEMA_ID",
    "SCHEMA_PATH",
    "render_schema",
    "ui_wire_schema",
    "write_schema",
]
