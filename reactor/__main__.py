# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""`python -m reactor` — the same server the `reactor` command launches.

Kept as a module entry point too, because a checkout has no console scripts on
PATH until something is installed, and "run the server" should not be the step
that needs a working install.
"""

from .host import main

if __name__ == "__main__":
    main()
