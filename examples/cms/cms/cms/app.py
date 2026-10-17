# Copyright (c) 2026-Present Datalayer, Inc.
#
# BSD 3-Clause License

"""ASGI entry point: `uvicorn cms.app:app --reload --port 8788`."""

from .host import create_app

app = create_app()
