# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Create the documented cms-astro development accounts and initial site."""

from __future__ import annotations

import argparse
import os
from collections.abc import Callable

from .store import Store


def seed_database(
    database: str,
    *,
    assume_yes: bool = False,
    input_fn: Callable[[str], str] | None = None,
) -> bool:
    """Seed an empty database, or reset an existing one after confirmation."""
    store = Store(database, auto_seed=False)
    summary = store.content_summary()
    has_content = any(summary.values())
    if has_content and not assume_yes:
        prompt = input_fn or input
        answer = prompt(
            f"{database} already contains {summary['sites']} site(s), "
            f"{summary['users']} user(s), and {summary['entries']} entry/entries. "
            "Remove all CMS data and reseed? [y/N] "
        )
        if answer.strip().lower() not in {"y", "yes"}:
            return False
    store.seed_demo(reset=has_content)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the Reactor Astro CMS database")
    parser.add_argument("--db", default=os.environ.get("CMS_ASTRO_DB", "examples/cms-astro/cms-astro.sqlite3"))
    parser.add_argument("-y", "--yes", action="store_true", help="reset existing CMS data without prompting")
    args = parser.parse_args()
    if not seed_database(args.db, assume_yes=args.yes):
        raise SystemExit("Seed cancelled; the existing database was not changed.")
    print(f"Seeded {args.db}")
    print("  admin / admin   (site administrator)")
    print("  user1 / user1   (content author)")
    print("  user2 / user2   (content author)")


if __name__ == "__main__":
    main()
