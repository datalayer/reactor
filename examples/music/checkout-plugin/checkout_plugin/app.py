"""ASGI entry point for the checkout backend (serves catalog + checkout).

    uvicorn checkout_plugin.app:app --reload --port 8799
"""

from .checkout import create_app

app = create_app()
