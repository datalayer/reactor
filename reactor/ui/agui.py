# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Ops as AG-UI events, for a host whose page already reads an AG-UI stream.

- ``show`` → ``ACTIVITY_SNAPSHOT``: the activity is the display, keyed by its
  id, with ``content = {"scope", "display"}``.
- ``patch`` and ``append`` → ``ACTIVITY_DELTA`` against that content (paths
  under ``/display``; an append is an ``add`` at ``<path>/-``).
- ``state`` → ``STATE_DELTA``.
- Everything else → ``CUSTOM`` named ``reactor.ui``, the op whole.

``ag-ui-protocol`` is imported when this is called, not when the reactor is:
it is optional, and a host on another transport never needs it.
"""

from __future__ import annotations

from typing import Any

from .channel import parse_op
from .wire import AppendOp, PatchOp, ShowOp, StateOp, UiOp

#: The activity type and custom-event name every op is carried under.
AGUI_NAME = "reactor.ui"


def _ag_ui() -> Any:
    try:
        from ag_ui import core
    except ImportError as error:  # pragma: no cover - depends on the environment
        raise ImportError(
            "reactor.ui.agui needs ag-ui-protocol: pip install ag-ui-protocol"
        ) from error
    return core


def encode_agui(op: UiOp | dict[str, Any]) -> Any:
    """One op as one AG-UI event."""
    core = _ag_ui()
    op = parse_op(op)
    if isinstance(op, ShowOp):
        return core.ActivitySnapshotEvent(
            message_id=op.body.id,
            activity_type=AGUI_NAME,
            content={"scope": op.scope, "display": op.body.model_dump(mode="json")},
            replace=True,
        )
    if isinstance(op, PatchOp):
        return core.ActivityDeltaEvent(
            message_id=op.id,
            activity_type=AGUI_NAME,
            patch=[
                {**operation.model_dump(mode="json", by_alias=True, exclude_unset=True), "path": "/display" + operation.path}
                for operation in op.body
            ],
        )
    if isinstance(op, AppendOp):
        return core.ActivityDeltaEvent(
            message_id=op.id,
            activity_type=AGUI_NAME,
            patch=[{"op": "add", "path": f"/display{op.body.path}/-", "value": op.body.value}],
        )
    if isinstance(op, StateOp):
        return core.StateDeltaEvent(
            delta=[operation.model_dump(mode="json", by_alias=True, exclude_unset=True) for operation in op.body]
        )
    return core.CustomEvent(name=AGUI_NAME, value=op.model_dump(mode="json", by_alias=True))


__all__ = ["AGUI_NAME", "encode_agui"]
