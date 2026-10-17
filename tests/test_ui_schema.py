# Copyright (c) 2026-Present Datalayer, Inc.
#
# BSD 3-Clause License

"""The committed wire schema is what the models generate."""

from __future__ import annotations

from pathlib import Path

from typer.testing import CliRunner

from reactor.cli import app
from reactor.ui.schema import SCHEMA_PATH, render_schema

ROOT = Path(__file__).resolve().parent.parent


def test_the_committed_schema_matches_the_models() -> None:
    committed = (ROOT / SCHEMA_PATH).read_text()
    assert committed == render_schema(), (
        "The reactor.ui models changed: run "
        "`reactor ui schema --out schema/reactor-ui.v1.schema.json` and update "
        "src/ui/wire.ts to match."
    )


def test_the_cli_writes_it(tmp_path: Path) -> None:
    out = tmp_path / "schema.json"
    result = CliRunner().invoke(app, ["ui", "schema", "--out", str(out)])
    assert result.exit_code == 0, result.output
    assert out.read_text() == render_schema()
