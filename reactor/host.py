# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""The host: a Reactor application somebody can install and run.

:func:`create_reactor_app` serves a platform's management API. That is the half
a developer needs; it is not an application. Every backend in this repository
went on to write the same twenty lines around it — build a platform, register
plugins, mount routers — and then left the *frontend* to somebody else: a second
build, a second server, a hard-coded URL between them.

That last part is the gap this module closes. A plugin platform whose UI has to
be deployed separately is not something a person can install, and "install it
and run it" is the whole claim one level up from
`packaging an extension <https://reactor.datalayer.tech/python/packaging>`_.

**On the name.** The obvious word is *shell*, and it is wrong twice over: in
this project the shell is already the browser-side container that mounts
plugins, and in a terminal it means something else again. The documentation has
used **host** throughout for "the application that runs plugins" — a host serves
the management API, a host is what ``provide_cli`` extends, a host decides what
an octicon id draws. This names the thing the vocabulary already had a word for.

@module reactor.host
"""

from __future__ import annotations

import argparse
import logging
from pathlib import Path
from typing import Any, Callable

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

from .extensions import find_share
from .reactor import PluginPlatform
from .web import create_reactor_app

logger = logging.getLogger(__name__)

#: Where a wheel puts a host's built UI, mirroring an extension's ``share/``.
UI_SHARE_DIRECTORY = "share/datalayer/reactor/apps"


def create_reactor_host(
    platform: PluginPlatform | None = None,
    *,
    ui: Path | str | None = None,
    title: str = "Datalayer Reactor",
    discover: bool | str = False,
    start: bool = True,
) -> FastAPI:
    """Build an application that serves both a platform and its UI.

    :param platform: the platform to serve. A fresh one is built if omitted.
    :param ui: directory holding a built single-page UI. ``None`` serves the API
        alone, which is what a backend-for-frontend wants — a host without a
        browser is still a host.
    :param title: shown in the OpenAPI document.
    :param discover: scan an entry-point group for
        :class:`~reactor.extensions.ReactorExtension` before serving. ``True``
        uses the default group; pass a string for your own. Extensions are then
        present from the *first* request rather than only once a browser has
        asked.
    :param start: run the platform's ``start`` hooks. Off for tests that want to
        inspect a composed platform without waking it.

    The route order is the part worth reading. Every API path is registered by
    :func:`create_reactor_app` and by the routers a caller mounts; the UI's
    catch-all is added **last** and only ever answers what nothing else claimed.
    Reversing that is the classic way an API starts replying with HTML.
    """
    runtime = platform or PluginPlatform()

    if discover:
        group = discover if isinstance(discover, str) else runtime.extension_group
        found = runtime.discover_extensions(group)
        if found:
            logger.info("Discovered extensions: %s", ", ".join(found))

    if start:
        runtime.start()

    app = create_reactor_app(runtime)
    app.title = title
    # Kept on the app so a caller that mounts its own routers can add the UI
    # afterwards, which is the order every real host needs.
    app.state.reactor = runtime
    app.state.reactor_ui = Path(ui) if ui else None
    return app


def mount_reactor_ui(app: FastAPI, ui: Path | str | None = None) -> bool:
    """Serve a built single-page UI from this application, at ``/``.

    Call it **after** every router the host mounts, because this adds a
    catch-all. Returns whether anything was mounted, so a host can say "no UI
    built" rather than serving a 404 nobody can explain.

    Single-page fallback rather than plain static files: a client-side route is
    a path this server has never heard of, and answering 404 to it means a
    refresh breaks the application. So an unknown path that is not a file gets
    ``index.html`` — and, crucially, an unknown path *under an API prefix* does
    not reach here at all, because those routes were registered first.
    """
    directory = Path(ui) if ui else getattr(app.state, "reactor_ui", None)
    if directory is None:
        return False
    directory = Path(directory).resolve()
    index = directory / "index.html"
    if not index.is_file():
        logger.warning("No UI at %s — serving the API alone.", directory)
        return False

    # Everything already routed, by its first path segment.
    #
    # A catch-all does not only answer paths nobody claimed — it also answers
    # the ones that *nearly* matched: a GET to a POST-only endpoint, a
    # mistyped plugin name. Those would come back as `index.html`, and a client
    # expecting JSON would fail parsing HTML with no idea why. So a request
    # under a prefix the API owns gets the API's answer, which is a 404.
    reserved = _reserved_prefixes(app.routes)

    @app.get("/{ui_path:path}", include_in_schema=False)
    def serve_ui(ui_path: str) -> FileResponse:
        # Resolve and require the result to still be inside, so `..` and
        # absolute paths go nowhere. The same check an extension's assets get.
        candidate = (directory / ui_path).resolve() if ui_path else index
        if candidate.is_file() and (candidate == index or directory in candidate.parents):
            return FileResponse(candidate)
        if ui_path.split("/")[0] in reserved:
            # The API owns this prefix. Answering with the application here is
            # how a mistyped endpoint becomes an unexplained parse error.
            raise HTTPException(status_code=404, detail="Not found")
        # Not a file: either a client-side route, or nothing. Both get the
        # application, which is the only answer that keeps a refresh working.
        if not index.is_file():
            raise HTTPException(status_code=404, detail="Not found")
        return FileResponse(index)

    logger.info("Serving UI from %s", directory)
    return True


def _reserved_prefixes(routes: Any, seen: set[int] | None = None) -> set[str]:
    """The first path segment of every route already registered.

    Recursive, and deliberately forgiving about *how* it recurses.
    ``include_router`` does not necessarily flatten what it includes — FastAPI
    0.141 keeps the included router as a node whose routes hang off
    ``original_router`` — so a scan of the top level alone misses every path a
    plugin mounted. That is not cosmetic: those are exactly the prefixes whose
    404 has to stay JSON rather than becoming the application's HTML.

    Following both `routes` and `original_router` means this keeps working
    across the versions that arrange it differently, which for a function whose
    failure is silent is worth more than knowing which one is installed.
    """
    seen = seen if seen is not None else set()
    prefixes: set[str] = set()
    for route in routes or ():
        if id(route) in seen:
            continue
        seen.add(id(route))
        path = getattr(route, "path", None)
        if isinstance(path, str):
            segment = path.lstrip("/").split("/")[0]
            if segment:
                prefixes.add(segment)
        for attribute in ("routes", "original_router"):
            nested = getattr(route, attribute, None)
            nested = getattr(nested, "routes", nested)
            if isinstance(nested, (list, tuple)) and nested:
                prefixes |= _reserved_prefixes(nested, seen)
    return prefixes


def find_ui(package_file: str | Path, app_name: str) -> Path | None:
    """Locate a host's built UI, in a wheel or in a source checkout.

    The same two places an extension's frontend can be — see
    :func:`reactor.extensions.find_share` — plus a check that there is actually
    an ``index.html`` there, because a directory without one is a build that
    did not happen rather than a UI.
    """
    directory = find_share(package_file, f"apps/{app_name}")
    if directory is not None and (directory / "index.html").is_file():
        return directory
    return None


def run_reactor_host(
    app: FastAPI | str,
    *,
    host: str = "127.0.0.1",
    port: int = 8799,
    reload: bool = False,
) -> None:
    """Serve a host with uvicorn — the call every console script was writing."""
    import uvicorn

    uvicorn.run(app, host=host, port=port, reload=reload)


def host_argument_parser(description: str, *, default_port: int = 8799) -> argparse.ArgumentParser:
    """The arguments a host's console script needs, in one place.

    A host that cannot be pointed at another port is not installable in
    practice — somebody already has 8799 — so this is not optional furniture.
    """
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--host", default="127.0.0.1", help="interface to bind")
    parser.add_argument("--port", type=int, default=default_port, help="port to bind")
    parser.add_argument(
        "--no-ui",
        action="store_true",
        help="serve the API only, without the built interface",
    )
    parser.add_argument(
        "--ui",
        default=None,
        metavar="DIR",
        help="serve a built single-page interface from this directory",
    )
    parser.add_argument("--reload", action="store_true", help="reload on code changes")
    return parser


def serve(
    build_app: Callable[..., FastAPI],
    *,
    description: str,
    default_port: int = 8799,
    argv: list[str] | None = None,
    **kwargs: Any,
) -> None:
    """Parse a host's arguments and serve it. The body of a console script."""
    import inspect

    args = host_argument_parser(description, default_port=default_port).parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    # `--ui` is only meaningful to a host that can be pointed at one. A host
    # that ships its own interface takes `with_ui` and nothing else, so the
    # flag is passed to whoever declared a parameter for it rather than to
    # everybody — which keeps one shared console-script body working for both.
    call: dict[str, Any] = {"with_ui": not args.no_ui, **kwargs}
    if "ui" in inspect.signature(build_app).parameters:
        call["ui"] = args.ui

    app = build_app(**call)
    run_reactor_host(app, host=args.host, port=args.port, reload=args.reload)


def create_base_app(*, with_ui: bool = True, ui: str | Path | None = None) -> FastAPI:
    """A Reactor server with no plugins of its own.

    Everything it runs was installed beside it. That is the whole application:
    a platform, the management API, and a scan of the entry-point group — so
    ``pip install`` an extension and this server has it, with no code anywhere
    naming it.

    It is what `reactor` on the command line launches, and it is worth having
    as a *product* rather than as a snippet in every example, because it is the
    smallest thing that demonstrates the claim. A host with plugins compiled
    into it can always be accused of knowing about them.

    Point it at a built interface with ``--ui`` when you have one; without it,
    the API is the whole surface, which is what a headless deployment or a
    separate frontend wants.
    """
    app = create_reactor_host(PluginPlatform(), title="Datalayer Reactor", discover=True)
    if with_ui and ui:
        mount_reactor_ui(app, ui)
    return app


def main() -> None:
    """The `reactor` console script: a server that runs what is installed."""
    serve(
        create_base_app,
        description=(
            "Serve a Datalayer Reactor platform. Every extension installed in "
            "this environment is discovered and served; none is named here."
        ),
        default_port=8787,
    )
