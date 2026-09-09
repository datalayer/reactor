#!/usr/bin/env python3
# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Copy the template into a new directory, with the names filled in.

    python new-extension.py acme-charts ~/src/acme-charts [--plugin @acme/charts]

Deliberately not a generator framework: it copies files and replaces three
placeholders in paths and contents. What comes out is yours, and readable.
"""

from __future__ import annotations

import argparse
import re
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TEMPLATE = HERE / "template"


def slug(name: str) -> str:
    cleaned = re.sub(r"[^a-z0-9-]+", "-", name.lower()).strip("-")
    if not cleaned:
        raise SystemExit(f"'{name}' leaves nothing usable as a name")
    return cleaned


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("name", help="the extension's name, e.g. acme-charts")
    parser.add_argument("target", help="directory to create")
    parser.add_argument("--plugin", help="the frontend plugin's name, e.g. @acme/charts")
    args = parser.parse_args(argv)

    name = slug(args.name)
    package = name.replace("-", "_")
    plugin = args.plugin or f"@{package.split('_')[0]}/{'-'.join(name.split('-')[1:]) or name}"
    target = Path(args.target).expanduser().resolve()
    if target.exists() and any(target.iterdir()):
        raise SystemExit(f"{target} exists and is not empty")

    subs = {"__NAME__": name, "__PACKAGE__": package, "__PLUGIN__": plugin}

    def fill(text: str) -> str:
        for key, value in subs.items():
            text = text.replace(key, value)
        return text

    for source in sorted(TEMPLATE.rglob("*")):
        relative = fill(str(source.relative_to(TEMPLATE)))
        destination = target / relative
        if source.is_dir():
            destination.mkdir(parents=True, exist_ok=True)
            continue
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            destination.write_text(fill(source.read_text()))
        except UnicodeDecodeError:
            shutil.copy2(source, destination)

    print(f"Created {target}")
    print(f"  extension : {name}")
    print(f"  package   : {package}   (also the container's name)")
    print(f"  plugin    : {plugin}")
    print("Next: (cd frontend && npm install && npm run build) && pip install .")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
