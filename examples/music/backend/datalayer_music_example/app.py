# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""ASGI entry point, for running this host under an external server.

    uvicorn datalayer_music_example.app:app --reload --port 8799

`datalayer-music-example` is the same thing with its arguments parsed for you.
"""

from .host import create_app

app = create_app()
