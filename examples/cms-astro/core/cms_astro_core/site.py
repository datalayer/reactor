"""Launch the Astro standalone server embedded in the Core wheel."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path


def _entrypoint() -> Path:
    relative = Path("share/datalayer/reactor/apps/cms-astro/server/entry.mjs")
    candidates = [Path(sys.prefix) / relative, Path(__file__).parents[1] / relative]
    for candidate in candidates:
        if candidate.is_file():
            return candidate
    raise FileNotFoundError("The CMS Astro server was not included in this Core installation; rebuild with `make cms-astro-package`.")


def main() -> None:
    node = shutil.which("node")
    if not node:
        raise SystemExit("Node.js is required to run the embedded Astro server")
    environment = os.environ.copy()
    environment.setdefault("HOST", "127.0.0.1")
    environment.setdefault("PORT", "4321")
    raise SystemExit(subprocess.call([node, str(_entrypoint())], env=environment))


__all__ = ["main"]
