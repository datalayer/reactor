# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

SHELL := /bin/bash

PYTHON ?= python3
NPM ?= npm
UVICORN ?= uvicorn

.PHONY: help install install-js install-py install-py-dev build build-js build-py typecheck package package-js package-py frontend frontend-backend music example-frontend example-frontend-backend example-music clean

help:
	@echo "Common Reactor operations"
	@echo ""
	@echo "  make install         Install JS deps and Python package in editable mode"
	@echo "  make build           Build TypeScript package"
	@echo "  make typecheck       Run TypeScript typecheck"
	@echo "  make package         Build JS and Python distributables"
	@echo "  make frontend          Run the frontend-only React example"
	@echo "  make frontend-backend  Run both backend and frontend for the combined example"
	@echo "  make music             Run the monorepo music example (plugin backend + app)"
	@echo "  make example-frontend          Alias for frontend example"
	@echo "  make example-frontend-backend  Alias for frontend-backend example"
	@echo "  make example-music             Alias for music example"
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

build-lib: ## build-lib
	npm run build:lib

publish-pypi: # publish the pypi package
	git clean -fdx && \
		python -m build
	@exec echo
	@exec echo twine upload ./dist/*-py3-none-any.whl
	@exec echo
	@exec echo https://pypi.org/project/datalayer-reactor/#history

publish-npm: clean build-lib ## publish-npm
	npm publish
	echo open https://www.npmjs.com/package/@datalayer/reactor

frontend:
	$(NPM) run example:dev

example-frontend: frontend

frontend-backend:
	@set -e; \
	trap 'if [ -n "$$PY_PID" ]; then kill $$PY_PID 2>/dev/null || true; fi' EXIT INT TERM; \
	$(PYTHON) -m $(UVICORN) --app-dir examples/frontend-backend reactor_demo:app --reload --port 8788 & \
	PY_PID=$$!; \
	$(NPM) run example:dev:frontend-backend

example-frontend-backend: frontend-backend

music: build-js
	@set -e; \
	kill_port() { \
		local port="$$1"; \
		local pids=""; \
		if command -v lsof >/dev/null 2>&1; then \
			pids="$$(lsof -ti tcp:$$port 2>/dev/null || true)"; \
		elif command -v fuser >/dev/null 2>&1; then \
			pids="$$(fuser -n tcp $$port 2>/dev/null || true)"; \
		elif command -v ss >/dev/null 2>&1; then \
			pids="$$(ss -ltnp "sport = :$$port" 2>/dev/null | sed -n 's/.*pid=\([0-9]\+\).*/\1/p' | sort -u)"; \
		fi; \
		if [ -n "$$pids" ]; then \
			kill $$pids 2>/dev/null || true; \
			if command -v lsof >/dev/null 2>&1; then \
				local remaining; remaining="$$(lsof -ti tcp:$$port 2>/dev/null || true)"; \
				if [ -n "$$remaining" ]; then kill -9 $$remaining 2>/dev/null || true; fi; \
			fi; \
		fi; \
	}; \
	cleanup() { \
		if [ -n "$$PY_PID" ]; then \
			pkill -P $$PY_PID 2>/dev/null || true; \
			kill $$PY_PID 2>/dev/null || true; \
		fi; \
		kill_port 8799; \
		kill_port 5179; \
	}; \
	trap cleanup EXIT INT TERM; \
	kill_port 8799; \
	kill_port 5179; \
	echo "[music] Installing Python backends..."; \
	$(PYTHON) -m pip install -e examples/music/catalog-plugin -e examples/music/checkout-plugin -e examples/music/playlist-plugin -e examples/music/mood-plugin -e examples/music/backend; \
	echo "[music] Starting backend on http://localhost:8799 ..."; \
	$(PYTHON) -m $(UVICORN) music_backend.app:app --reload --port 8799 & \
	PY_PID=$$!; \
	echo "[music] Starting frontend on http://localhost:5179 ..."; \
	$(NPM) run dev --prefix examples/music

example-music: music

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
	rm -rf reactor/__pycache__
	rm -rf examples/__pycache__
	rm -rf ./*.tgz
	rm -rf ./.venv
