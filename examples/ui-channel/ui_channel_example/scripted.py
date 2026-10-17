# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""One scripted session, recorded: the ops the page's test replays.

``fixtures/demo-ops.json`` is this module's output, committed. The Python test
checks it is still what the desk emits; the TypeScript test feeds it to the
reducer. Regenerate with::

    python examples/ui-channel/ui_channel_example/scripted.py > examples/ui-channel/fixtures/demo-ops.json
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from typing import Any

if __package__ in (None, ""):
    # Run as a script from a checkout: the package sits one folder up.
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ui_channel_example.approval import DECIDE, Approval  # noqa: E402
from ui_channel_example.desk import ApprovalDesk  # noqa: E402

#: A fixed key, so the recorded tokens are the same on every run. Never in a real host.
SECRET = b"ui-channel-example-not-a-secret!"
SESSION = "demo"


def demo_desk() -> ApprovalDesk:
    return ApprovalDesk(SECRET)


async def record(desk: ApprovalDesk) -> list[dict[str, Any]]:
    laptop = desk.request(
        SESSION,
        Approval(
            id="laptop",
            title="Laptop",
            amount_eur=1890,
            requester="ada",
            reviewer_note="Above the 1500 EUR team budget",
            vendor_key="vk-not-for-the-page",
        ),
    )
    desk.request(SESSION, Approval(id="train", title="Train to Ghent", amount_eur=64.5, requester="grace"))
    await desk.press(
        "grace",
        SESSION,
        {
            "action": DECIDE,
            "display_id": laptop.id,
            "token": laptop.actions[0].token,
            "payload": {"approve": True, "comment": "Fine, it replaces the 2019 one"},
            "idempotency_id": "press-1",
        },
    )
    return desk.ops(SESSION)


def main() -> None:
    ops = asyncio.run(record(demo_desk()))
    sys.stdout.write(json.dumps(ops, indent=2) + "\n")


if __name__ == "__main__":
    main()
