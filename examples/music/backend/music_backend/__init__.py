# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Backend host composing every music example plugin on one platform.

Only :func:`create_app` is exported: importing this package should not build an
application, so the ASGI entry point in ``app.py`` stays the one place that does.
"""

from .backend import create_app

__all__ = ["create_app"]
