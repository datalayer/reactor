SHELL := /bin/bash

PYTHON ?= python3
NPM ?= npm
UVICORN ?= uvicorn

.PHONY: help install install-js install-py install-py-dev build build-js build-py typecheck package package-js package-py frontend frontend-backend music clean

help:
	@echo "Common Reactor operations"
	@echo ""
	@echo "  make install         Install JS deps and Python package in editable mode"
	@echo "  make build           Build TypeScript package"
	@echo "  make typecheck       Run TypeScript typecheck"
	@echo "  make package         Build JS and Python distributables"
	@echo "  make frontend          Run the frontend-only React example"
	@echo "  make frontend-backend  Run both backend and frontend for the combined example"
	@echo "  make music             Run the monorepo music example (catalog backend + app)"
	@echo "  make clean           Remove build artifacts"

install: install-js install-py

install-js:
	$(NPM) install
	$(NPM) install --prefix examples/frontend
	$(NPM) install --prefix examples/frontend-backend
	$(NPM) install --prefix examples/music

install-py:
	$(PYTHON) -m pip install -e .

install-py-dev:
	$(PYTHON) -m pip install -e .[dev]
	$(PYTHON) -m pip install build

build: build-js

build-js:
	$(NPM) run build

typecheck:
	$(NPM) run typecheck

package: package-js package-py

package-js:
	$(NPM) pack

package-py:
	$(PYTHON) -m pip install build
	$(PYTHON) -m build

frontend:
	$(NPM) run example:dev

frontend-backend:
	@set -e; \
	trap 'if [ -n "$$PY_PID" ]; then kill $$PY_PID 2>/dev/null || true; fi' EXIT INT TERM; \
	$(PYTHON) -m $(UVICORN) --app-dir examples/frontend-backend python_platform_demo:app --reload --port 8788 & \
	PY_PID=$$!; \
	$(NPM) run example:dev:frontend-backend

music: build-js
	@set -e; \
	trap 'if [ -n "$$PY_PID" ]; then kill $$PY_PID 2>/dev/null || true; fi' EXIT INT TERM; \
	$(PYTHON) -m pip install -e examples/music/catalog-plugin -e examples/music/checkout-plugin; \
	$(NPM) install --prefix examples/music; \
	$(PYTHON) -m $(UVICORN) checkout_plugin.app:app --reload --port 8799 & \
	PY_PID=$$!; \
	$(NPM) run dev --prefix examples/music

clean:
	rm -rf dist
	rm -rf build
	rm -rf *.egg-info
	rm -rf .pytest_cache
	rm -rf .mypy_cache
	rm -rf examples/frontend/node_modules
	rm -rf examples/frontend-backend/node_modules
	rm -rf examples/music/node_modules
	rm -rf examples/music/*/node_modules
	rm -rf node_modules
	rm -rf __pycache__
	rm -rf datalayer_reactor/__pycache__
	rm -rf examples/__pycache__
	rm -rf ./*.tgz
	rm -rf ./.venv
