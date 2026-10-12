# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""The AG-UI stream the page's decoder is tested on is what ``encode_agui`` sends.

``schema/reactor-ui.v1.agui-examples.json`` holds a sequence of ops and the
AG-UI events ``encode_agui`` turns them into, as JSON goes on the wire
(camelCase). ``src/ui/__tests__/agui.test.ts`` decodes the events and checks
the page ends with the model the ops give: the encoder and the decoder are
held to one file.
"""

from __future__ import annotations

import json
from pathlib import Path

from reactor.ui.agui import encode_agui

ROOT = Path(__file__).resolve().parent.parent
EXAMPLES = ROOT / "schema" / "reactor-ui.v1.agui-examples.json"

CARD = {
    "type": "application/vnd.example.card+json",
    "version": 1,
    "id": "card-1",
    "text": "A card",
    "data": {"status": "open", "history": []},
    "actions": [{"name": "close", "label": "Close", "token": "t0k"}],
}

OPS = [
    {"v": 1, "op": "show", "scope": "s1", "id": "card-1", "body": CARD},
    {
        "v": 1,
        "op": "patch",
        "scope": "s1",
        "id": "card-1",
        "body": [
            {"op": "replace", "path": "/data/status", "value": "closed"},
            {"op": "copy", "from": "/data/status", "path": "/data/was"},
        ],
    },
    {
        "v": 1,
        "op": "append",
        "scope": "s1",
        "id": "card-1",
        "body": {"path": "/data/history", "value": "closed by ada"},
    },
    {"v": 1, "op": "meta", "scope": "s1", "body": {"title": "Cards"}},
    {
        "v": 1,
        "op": "ask",
        "scope": "s1",
        "id": "q-1",
        "body": {**CARD, "id": "q-1", "text": "Which?", "actions": []},
    },
    {"v": 1, "op": "remove", "scope": "s1", "id": "card-1"},
]


def render_examples() -> str:
    events = [
        encode_agui(op).model_dump(mode="json", by_alias=True, exclude_none=True)
        for op in OPS
    ]
    return json.dumps({"ops": OPS, "events": events}, indent=2) + "\n"


def test_the_committed_examples_are_what_the_encoder_sends() -> None:
    assert EXAMPLES.read_text() == render_examples(), (
        "encode_agui changed: write render_examples() to "
        "schema/reactor-ui.v1.agui-examples.json and check the decoder "
        "(src/ui/agui.ts) still reads it."
    )


if __name__ == "__main__":  # pragma: no cover - writes the file
    EXAMPLES.write_text(render_examples())
