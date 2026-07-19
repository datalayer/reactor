# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""ASGI entry point for the catalog backend.

    uvicorn catalog_plugin.app:app --reload --port 8799
"""

from .catalog import create_app

app = create_app()
