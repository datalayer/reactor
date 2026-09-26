#!/usr/bin/env python3
# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

# Copyright (c) 2024- Datalayer, Inc.
#
# BSD 3-Clause License

"""Bump the version, in every package this repository releases.

Seven packages, one version: the five npm packages (`@datalayer/reactor` and
the four plugins), `datalayer-reactor` on PyPI — which reads its version from
the root `package.json`, so it carries no copy — and `reactor-mcp-server`,
whose `pyproject.toml` carries the version and a floor on `datalayer_reactor`.
The root `package.json` is the source of truth; everything else is a copy,
and a copy that gets missed ships a package whose version disagrees with the
tag the release workflow checks it against.

    python dev/bump_version.py patch     # 1.0.3 -> 1.0.4
    python dev/bump_version.py minor     # 1.0.3 -> 1.1.0
    python dev/bump_version.py major     # 1.0.3 -> 2.0.0
    python dev/bump_version.py           # asks
    python dev/bump_version.py patch --dry-run

Nothing is written unless **every** file can be updated. Either all of them
move or none do. The plugins' own floor on `@datalayer/reactor` is left
alone on purpose: npm resolves the root package from the registry, where the
version being released does not exist yet.

@module dev.bump_version
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: The file the version is read *from*; hatch-nodejs-version reads it too for
#: `datalayer-reactor`, which is what makes it the source rather than a copy.
SOURCE = ROOT / "package.json"

PLUGINS = ("commands", "graph", "manager", "shell")
MCP_PYPROJECT = ROOT / "plugins" / "mcp-server" / "pyproject.toml"
MCP_INIT = ROOT / "plugins" / "mcp-server" / "reactor_mcp_server" / "__init__.py"

PARTS = ("major", "minor", "patch")


class Unbumpable(Exception):
    """A file this script cannot update, named with what it expected.

    Raised before anything is written.
    """


def read_version() -> str:
    version = json.loads(SOURCE.read_text()).get("version")
    if not version:
        raise Unbumpable(f"{SOURCE.relative_to(ROOT)} has no version")
    return str(version)


def bump(version: str, part: str) -> str:
    """The next version, or a refusal naming what it could not read.

    Only `major.minor.patch`: a pre-release tag would need rules about what
    bumping means for it, and guessing one is worse than saying so.
    """
    match = re.fullmatch(r"(\d+)\.(\d+)\.(\d+)", version)
    if match is None:
        raise Unbumpable(
            f"{version!r} is not major.minor.patch; bump it by hand and say "
            "here what the next one should be"
        )
    major, minor, patch = (int(value) for value in match.groups())
    if part == "major":
        return f"{major + 1}.0.0"
    if part == "minor":
        return f"{major}.{minor + 1}.0"
    return f"{major}.{minor}.{patch + 1}"


def _replace_once(path: Path, pattern: str, replacement: str, current: str) -> str:
    """One substitution, refusing zero and refusing more than one.

    Zero means the file's format changed and this script is now editing
    nothing while reporting success. More than one means the pattern is
    matching something else as well — a dependency's version, say.
    """
    text = path.read_text()
    found = re.findall(pattern, text, flags=re.M)
    if len(found) != 1:
        raise Unbumpable(
            f"{path.relative_to(ROOT)}: expected exactly one "
            f"{current!r} matching {pattern!r}, found {len(found)}"
        )
    return re.sub(pattern, replacement, text, count=1, flags=re.M)


def planned_edits(current: str, new: str) -> dict[Path, str]:
    """Every file's new content, or an exception. Nothing is written here."""
    escaped = re.escape(current)
    edits: dict[Path, str] = {}

    version_field = rf'(^\s*"version"\s*:\s*")({escaped})(")'
    edits[SOURCE] = _replace_once(SOURCE, version_field, rf"\g<1>{new}\g<3>", current)
    for plugin in PLUGINS:
        path = ROOT / "plugins" / plugin / "package.json"
        edits[path] = _replace_once(path, version_field, rf"\g<1>{new}\g<3>", current)

    # The MCP server: its own version, then its floor on the root package,
    # which moves with it (pip installs the root package from the tree).
    text = _replace_once(
        MCP_PYPROJECT, rf'(^version\s*=\s*")({escaped})(")', rf"\g<1>{new}\g<3>", current
    )
    floor = rf'("datalayer_reactor>=)({escaped})(")'
    if len(re.findall(floor, text)) != 1:
        raise Unbumpable(
            f"{MCP_PYPROJECT.relative_to(ROOT)}: expected exactly one "
            f'"datalayer_reactor>={current}"'
        )
    edits[MCP_PYPROJECT] = re.sub(floor, rf"\g<1>{new}\g<3>", text, count=1)

    # The fallback literal, for a source tree that is not installed.
    edits[MCP_INIT] = _replace_once(
        MCP_INIT, rf'(__version__\s*=\s*")({escaped})(")', rf"\g<1>{new}\g<3>", current
    )
    return edits


def check_json(edits: dict[Path, str]) -> None:
    for path, text in edits.items():
        if path.suffix == ".json":
            try:
                json.loads(text)
            except ValueError as error:
                raise Unbumpable(f"{path.relative_to(ROOT)} would not parse: {error}")


def ask() -> str:
    current = read_version()
    print(f"Current version: {current}")
    for index, part in enumerate(PARTS, start=1):
        print(f"  {index}) {part:5s} -> {bump(current, part)}")
    while True:
        answer = input("Which? [major/minor/patch] ").strip().lower()
        if answer in PARTS:
            return answer
        if answer in ("1", "2", "3"):
            return PARTS[int(answer) - 1]
        print(f"Say one of: {', '.join(PARTS)}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("part", nargs="?", choices=PARTS, help="what to bump")
    parser.add_argument(
        "--dry-run", action="store_true", help="say what would change and write nothing"
    )
    arguments = parser.parse_args(argv)

    try:
        current = read_version()
        part = arguments.part or ask()
        new = bump(current, part)
        edits = planned_edits(current, new)
        check_json(edits)
    except Unbumpable as error:
        print(f"Refused: {error}", file=sys.stderr)
        print("Nothing was written.", file=sys.stderr)
        return 1

    for path, text in sorted(edits.items()):
        if not arguments.dry_run:
            path.write_text(text)
        print(f"{'would bump' if arguments.dry_run else 'bumped'} {path.relative_to(ROOT)}")
    print(f"{current} -> {new}")
    if not arguments.dry_run:
        print(f"Next: commit on a branch, open the pull request; after merge, tag v{new}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
