# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT / "x402"))

from cms_astro_x402 import X402Plugin


def test_x402_challenge_verify_and_settle() -> None:
    plugin = X402Plugin()
    payload = {"method": "GET", "path": "/premium/launch", "price": "0.25", "payer": "0xreader"}
    challenge = plugin.invoke_action("enforce", payload)
    assert challenge["status"] == 402
    assert "PAYMENT-REQUIRED" in challenge["headers"]
    signature = plugin.invoke_action("issue_demo_signature", payload)["paymentSignature"]
    settled = plugin.invoke_action("enforce", payload | {"paymentSignature": signature})
    assert settled["status"] == 200
    assert settled["receipt"]["payer"] == "0xreader"
    assert "PAYMENT-RESPONSE" in settled["headers"]


def test_x402_rejects_invalid_signature() -> None:
    result = X402Plugin().invoke_action("enforce", {"path": "/premium", "paymentSignature": "invalid"})
    assert result["status"] == 402
    assert "error" in result["body"]


def test_x402_signature_is_bound_to_payment_requirements() -> None:
    plugin = X402Plugin()
    payload = {
        "method": "GET",
        "path": "/premium/launch",
        "price": "0.25",
        "network": "eip155:84532",
        "asset": "USDC",
        "payTo": "0x1111111111111111111111111111111111111111",
    }
    signature = plugin.issue_demo_signature(payload)

    for changed in (
        {"price": "0.01"},
        {"network": "eip155:1"},
        {"asset": "DAI"},
        {"payTo": "0x2222222222222222222222222222222222222222"},
    ):
        result = plugin.enforce(payload | changed | {"paymentSignature": signature})
        assert result["status"] == 402
        assert result["body"]["error"] == "invalid payment signature"
