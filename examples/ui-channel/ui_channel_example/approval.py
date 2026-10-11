# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""The approval card: one display type, one action, one plugin.

``Approval`` is what the page draws and what a model is told about. Two of its
fields are for the person only: the reviewer's note on why it was flagged, and
the history of decisions with the comments typed on the page. The vendor's
portal key is a secret: neither view carries it.

``Decide`` is the payload the page sends back when someone presses Approve or
Reject. Its comment is for the person too: the model learns the decision, not
what was typed with it.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Annotated, Any, Literal

from pydantic import BaseModel, SecretStr

from reactor.ui import Display, DisplayRegistry, UiAction, audience, display_type

if TYPE_CHECKING:
    from .desk import ApprovalDesk

#: The display type the page's renderer claims.
APPROVAL_TYPE = "application/vnd.reactor-example.approval+json"

#: The one action an approval offers.
DECIDE = "approvals.decide"


@display_type(APPROVAL_TYPE, version=1)
class Approval(Display):
    title: str
    amount_eur: float
    requester: str
    status: Literal["pending", "approved", "rejected"] = "pending"
    # The person sees why it was flagged; the model is told the amount only.
    reviewer_note: Annotated[str, audience("page")] = ""
    # What was decided, with the comment typed on the page.
    history: Annotated[list[str], audience("page")] = []
    # The key to the vendor's portal: it never leaves the server.
    vendor_key: SecretStr | None = None

    def text(self) -> str:
        return f"{self.title}: {self.amount_eur:.2f} EUR for {self.requester} ({self.status})"


class Decide(BaseModel):
    approve: bool
    comment: Annotated[str, audience("page")] = ""


class ApprovalPlugin:
    """Declares the display type, and refuses a requester deciding their own request."""

    def __init__(self, desk: "ApprovalDesk") -> None:
        self._desk = desk

    def provide_display_types(self, registry: DisplayRegistry) -> None:
        registry.register(Approval)

    def authorize_ui_action(self, principal: Any, session: str, action: UiAction) -> bool | None:
        if action.action != DECIDE:
            return None
        approval = self._desk.get(action.display_id)
        return approval is None or approval.requester != principal


__all__ = ["APPROVAL_TYPE", "DECIDE", "Approval", "ApprovalPlugin", "Decide"]
