# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""ASGI entry point for the playlist backend (catalog + playlist, no rules).

    uvicorn playlist_plugin.app:app --reload --port 8799
"""

from .playlist import create_app

app = create_app()
