# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""ASGI entry point for the music backend host (every plugin on one platform).

    uvicorn music_backend.app:app --reload --port 8799
"""

from .backend import create_app

app = create_app()
