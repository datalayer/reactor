"""Create the documented cms-astro development accounts and initial site."""

from __future__ import annotations

import argparse
import os

from .store import Store


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed the Reactor Astro CMS database")
    parser.add_argument("--db", default=os.environ.get("CMS_ASTRO_DB", "examples/cms-astro/cms-astro.sqlite3"))
    args = parser.parse_args()
    Store(args.db).seed_demo()
    print(f"Seeded {args.db}")
    print("  admin / admin   (site administrator)")
    print("  user1 / user1   (content author)")
    print("  user2 / user2   (content author)")


if __name__ == "__main__":
    main()
