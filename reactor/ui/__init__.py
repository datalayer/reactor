# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""The data plane between a Python host and the page: ``reactor.ui``.

- :mod:`~reactor.ui.wire` — the envelope, its eight ops, the display, the action.
- :mod:`~reactor.ui.display` — ``@display_type``, audiences, ``model_view``.
- :mod:`~reactor.ui.actions` — typed actions, minted tokens, the veto hook.
- :mod:`~reactor.ui.channel` — ``UiChannel`` and the op helpers.
- :mod:`~reactor.ui.agui` — ops as AG-UI events (needs ``ag-ui-protocol``).
- :mod:`~reactor.ui.schema` — the wire as JSON Schema.
- :mod:`~reactor.ui.ws` — the channel over one WebSocket: ``UiHub``, ``UiSocket``.

The TypeScript half is ``@datalayer/reactor/ui`` (renderer registry, tool
bindings, the reducer) and ``@datalayer/reactor/ui/react`` (``ReactorDisplay``).
"""

from .actions import (
    ActionRegistry,
    RegisteredAction,
    UiActionBusy,
    UiActionContext,
    UiActionError,
    UiActionPayloadInvalid,
    UiActionRefused,
    UiActionTokenInvalid,
    UnknownUiAction,
)
from .channel import MemoryUiChannel, UiChannel, parse_op
from .display import (
    DISPLAY_TYPES,
    Audience,
    DisplayRegistry,
    audience,
    display_type,
    model_view,
    page_view,
)
from .wire import (
    ANSWER_ACTION,
    UI_WIRE_VERSION,
    Answer,
    ActionFrame,
    ActionOffer,
    AppendBody,
    AppendOp,
    AskOp,
    Display,
    DisplayWire,
    DownFrame,
    FileRef,
    HelloFrame,
    MetaOp,
    OpFrame,
    PatchAdd,
    PatchCopy,
    PatchMove,
    PatchOp,
    PatchOperation,
    PatchRemove,
    PatchReplace,
    PatchTest,
    PingFrame,
    PongFrame,
    RemoveOp,
    ResultFrame,
    ShowOp,
    StateFrame,
    StateOp,
    UiAction,
    UiOp,
    UpFrame,
    WelcomeFrame,
    WindowBody,
    WindowOp,
)

#: The key under which a tool result's ``_meta`` carries a display.
DISPLAY_META_KEY = "reactor.ui/display"

__all__ = [
    "ANSWER_ACTION",
    "Answer",
    "DISPLAY_META_KEY",
    "DISPLAY_TYPES",
    "UI_WIRE_VERSION",
    "ActionFrame",
    "ActionOffer",
    "ActionRegistry",
    "AppendBody",
    "AppendOp",
    "AskOp",
    "Audience",
    "Display",
    "DisplayRegistry",
    "DisplayWire",
    "DownFrame",
    "FileRef",
    "HelloFrame",
    "MemoryUiChannel",
    "MetaOp",
    "OpFrame",
    "PatchAdd",
    "PatchCopy",
    "PatchMove",
    "PatchOp",
    "PatchOperation",
    "PatchRemove",
    "PatchReplace",
    "PatchTest",
    "PingFrame",
    "PongFrame",
    "RegisteredAction",
    "RemoveOp",
    "ResultFrame",
    "ShowOp",
    "StateFrame",
    "StateOp",
    "UiAction",
    "UiActionBusy",
    "UiActionContext",
    "UiActionError",
    "UiActionPayloadInvalid",
    "UiActionRefused",
    "UiActionTokenInvalid",
    "UiChannel",
    "UiOp",
    "UnknownUiAction",
    "UpFrame",
    "WelcomeFrame",
    "WindowBody",
    "WindowOp",
    "audience",
    "display_type",
    "model_view",
    "page_view",
    "parse_op",
]
