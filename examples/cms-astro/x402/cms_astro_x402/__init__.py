# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Optional x402 paid-content extension discovered by Reactor."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any

from reactor import (
    ExtensionManifest,
    FrontendExtension,
    FrontendPlugin,
    PluginCompatibility,
    PluginManifest,
    ReactorExtension,
    define_contribution_point,
    find_extension_frontend,
)

EDITOR_ACTIONS = define_contribution_point("cmsAstro.editorAction")
DASHBOARD_WIDGETS = define_contribution_point("cmsAstro.dashboardWidget")

X402_MANIFEST = PluginManifest(
    name="cms-astro.x402",
    version="0.1.0",
    display_name="CMS x402",
    description="HTTP 402 payment requirements and paid-content enforcement.",
    emoji="💳",
    frontend_dependencies=["@cms-astro/x402"],
    compatibility=PluginCompatibility(api_version="v1"),
)


def _b64(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode().rstrip("=")


def _decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


class X402Plugin:
    """Small deterministic verifier for local development.

    A production deployment should replace ``verify``/``settle`` with an x402
    facilitator. The requirements shape and HTTP headers intentionally mirror
    that protocol so the integration boundary stays the same.
    """

    def __init__(self) -> None:
        self.pay_to = os.getenv("CMS_X402_PAY_TO", "0x0000000000000000000000000000000000000000")
        self.network = os.getenv("CMS_X402_NETWORK", "eip155:84532")
        self.default_price = os.getenv("CMS_X402_PRICE", "0.01")
        self.secret = os.getenv("CMS_X402_DEMO_SECRET", "cms-astro-local-development").encode()
        self.timeout = int(os.getenv("CMS_X402_TIMEOUT", "60"))

    def provide_contributions(self, contributions) -> None:
        contributions.contribute(EDITOR_ACTIONS, {"id": "x402", "name": "Configure paid access"}, contribution_id="x402")
        contributions.contribute(DASHBOARD_WIDGETS, {"id": "x402-status", "name": "x402 payment status"}, contribution_id="x402-status")

    def requirements(self, payload: dict[str, Any]) -> dict[str, Any]:
        return {
            "x402Version": 1,
            "accepts": [{
                "scheme": "exact",
                "network": str(payload.get("network") or self.network),
                "maxAmountRequired": str(payload.get("price") or self.default_price),
                "resource": str(payload.get("path") or "/"),
                "description": str(payload.get("description") or "Premium CMS content"),
                "mimeType": str(payload.get("mimeType") or "text/html"),
                "payTo": str(payload.get("payTo") or self.pay_to),
                "maxTimeoutSeconds": self.timeout,
                "asset": str(payload.get("asset") or "USDC"),
            }],
        }

    def _signature_message(self, payload: dict[str, Any], timestamp: int, payer: str) -> str:
        requirements = _b64(
            json.dumps(
                self.requirements(payload),
                sort_keys=True,
                separators=(",", ":"),
            ).encode()
        )
        return f"{payload.get('method', 'GET').upper()}\n{payload.get('path', '/')}\n{timestamp}\n{payer}\n{requirements}"

    def issue_demo_signature(self, payload: dict[str, Any]) -> str:
        """Issue a local-only signature, useful in tests and the example UI."""
        timestamp = int(payload.get("timestamp") or time.time())
        payer = _b64(str(payload.get("payer") or "demo-payer").encode())
        message = self._signature_message(payload, timestamp, payer)
        digest = hmac.new(self.secret, message.encode(), hashlib.sha256).hexdigest()
        return f"v1.{timestamp}.{payer}.{digest}"

    def verify(self, signature: str, payload: dict[str, Any]) -> dict[str, Any]:
        try:
            version, stamp, payer, supplied = signature.split(".", 3)
            timestamp = int(stamp)
            if version != "v1" or abs(int(time.time()) - timestamp) > self.timeout:
                raise ValueError("expired payment signature")
            message = self._signature_message(payload, timestamp, payer)
            expected = hmac.new(self.secret, message.encode(), hashlib.sha256).hexdigest()
            if not hmac.compare_digest(supplied, expected):
                raise ValueError("invalid payment signature")
            network = self.requirements(payload)["accepts"][0]["network"]
            return {"valid": True, "payer": _decode(payer).decode(), "network": network}
        except (ValueError, UnicodeError) as error:
            return {"valid": False, "reason": str(error)}

    def enforce(self, payload: dict[str, Any]) -> dict[str, Any]:
        requirements = self.requirements(payload)
        signature = str(payload.get("paymentSignature") or payload.get("payment-signature") or "")
        encoded = _b64(json.dumps(requirements, separators=(",", ":")).encode())
        if not signature:
            return {"paid": False, "status": 402, "headers": {"PAYMENT-REQUIRED": encoded}, "body": requirements}
        verification = self.verify(signature, payload)
        if not verification["valid"]:
            return {"paid": False, "status": 402, "headers": {"PAYMENT-REQUIRED": encoded}, "body": {**requirements, "error": verification["reason"]}}
        receipt = {"success": True, "payer": verification["payer"], "network": verification["network"], "settled": True}
        return {"paid": True, "status": 200, "headers": {"PAYMENT-RESPONSE": _b64(json.dumps(receipt, separators=(",", ":")).encode())}, "receipt": receipt}

    def invoke_action(self, action: str, payload: dict | None = None, tenant_id: str | None = None) -> dict:
        value = payload or {}
        if action == "requirements": return self.requirements(value)
        if action == "issue_demo_signature": return {"paymentSignature": self.issue_demo_signature(value)}
        if action == "verify": return self.verify(str(value.get("paymentSignature") or ""), value)
        if action == "enforce": return self.enforce(value)
        raise ValueError(f"Unsupported action '{action}'")


def extension() -> ReactorExtension:
    return ReactorExtension(
        manifest=ExtensionManifest(name="cms-astro-x402", version="0.1.0", display_name="CMS x402", description="Paid Astro content over HTTP 402", emoji="💳"),
        plugins=[(X402_MANIFEST, X402Plugin())],
        frontend=FrontendExtension(
            directory=find_extension_frontend(__file__, "cms-astro-x402"),
            entry="index.js",
            api_version="v1",
            plugins=[FrontendPlugin(name="@cms-astro/x402", version="0.1.0", display_name="CMS x402 UI", description="Paid-content controls and payment status", emoji="💳", required_backend_plugins=["cms-astro.x402"])],
        ),
    )


__all__ = ["X402Plugin", "extension"]
