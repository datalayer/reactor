# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Files as references: uploaded once, named after (REACTOR_UI P6, RU-6).

A file never rides inside JSON — not in an op, not in a press, not in a run.
The page uploads its bytes to the host first and receives a
:class:`~reactor.ui.wire.FileRef`; what it sends afterwards — a press
answering a question, a message's files — carries the ref only, and the host
reads the bytes back from its :class:`UiFiles`.

A file is kept under its **scope** (a conversation) and its **owner** (whoever
uploaded it, as the host's ``authenticate`` names them): a ref read back by
anybody else, or in another scope, is not found. Its ``url`` is a **signed**,
short-lived path the page may fetch it from without its credential — the
signature says this scope, this ref and this expiry, nothing else.

A host keeps one :class:`UiFiles` and mounts :class:`UiFilesRoutes`: an
upload (``POST``, the bytes as the body; the credential in ``Authorization``,
the scope in ``X-Reactor-Scope``, the name in ``X-Reactor-File-Name``
percent-encoded, the media type in ``Content-Type``) and a download (``GET``
with ``expires`` and ``sig``).

Refusals carry the HTTP status a route answers with: a file too large is
``413``; a ref unknown, of another scope or another owner ``404``; a
signature that does not match or has expired ``403``; an upload without its
scope or its name ``400``; a credential refused ``401``.

::

    files = UiFiles(secret)
    ref = files.put("thread-1", owner, "orders.csv", "text/csv", content, prefix="/files")
    stored = files.get("thread-1", ref.ref, owner)
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import inspect
import secrets
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Hashable
from urllib.parse import quote, unquote

from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from .wire import FileRef

#: The largest file kept by default: 25 MB.
MAX_FILE_BYTES = 25 * 1024 * 1024

#: How much a store keeps in all by default, oldest dropped first: 256 MB.
MAX_KEPT_BYTES = 256 * 1024 * 1024

#: How long a signed url answers by default, in seconds.
SIGNED_SECONDS = 300

#: The headers an upload says its scope and its name in.
SCOPE_HEADER = "X-Reactor-Scope"
NAME_HEADER = "X-Reactor-File-Name"


class UiFileError(Exception):
    """A file refused. ``status_code`` is what a route answers with."""

    status_code = 400


class UiFileTooLarge(UiFileError):
    """Larger than the store takes."""

    status_code = 413


class UnknownUiFile(UiFileError):
    """No such file kept here — or not in this scope, or not this owner's."""

    status_code = 404


class UiFileSignatureInvalid(UiFileError):
    """A download whose signature does not match, or whose time is up."""

    status_code = 403


class UiFileUnauthorized(UiFileError):
    """An upload whose credential the host refused."""

    status_code = 401


@dataclass(frozen=True)
class StoredFile:
    """A file as the store keeps it."""

    ref: str
    scope: str
    owner: Hashable
    name: str
    media_type: str
    content: bytes


class UiFiles:
    """Files by scope and ref, for their owner, with signed urls.

    ``secret`` keys the signatures; ``max_file`` bounds one file,
    ``max_kept`` all of them — the oldest are forgotten first to make room.
    ``clock`` is the time in seconds, for tests.
    """

    def __init__(
        self,
        secret: bytes,
        *,
        max_file: int = MAX_FILE_BYTES,
        max_kept: int = MAX_KEPT_BYTES,
        clock: Callable[[], float] = time.time,
    ) -> None:
        if len(secret) < 16:
            raise ValueError("A files secret needs at least 16 bytes")
        if max_file < 1 or max_kept < max_file:
            raise ValueError("max_file must be at least 1, and max_kept at least max_file")
        self._secret = secret
        self._max_file = max_file
        self._max_kept = max_kept
        self._clock = clock
        self._files: OrderedDict[tuple[str, str], StoredFile] = OrderedDict()
        self._kept = 0

    @property
    def max_file(self) -> int:
        return self._max_file

    def put(
        self,
        scope: str,
        owner: Hashable,
        name: str,
        media_type: str,
        content: bytes,
        *,
        prefix: str = "",
        expires_in: int = SIGNED_SECONDS,
    ) -> FileRef:
        """Keep a file; its ref, with a signed url under ``prefix`` when one is said."""
        if not scope:
            raise UiFileError("A file is kept under a scope")
        if not name.strip():
            raise UiFileError("A file has a name")
        if len(content) > self._max_file:
            raise UiFileTooLarge(
                f"{name} is {len(content):,} bytes: a file is at most {self._max_file:,}"
            )
        ref = secrets.token_urlsafe(18)
        stored = StoredFile(
            ref=ref,
            scope=scope,
            owner=owner,
            name=name,
            media_type=media_type or "application/octet-stream",
            content=content,
        )
        self._files[(scope, ref)] = stored
        self._kept += len(content)
        while self._kept > self._max_kept:
            _, oldest = self._files.popitem(last=False)
            self._kept -= len(oldest.content)
        return self.ref_of(stored, prefix=prefix, expires_in=expires_in)

    def ref_of(self, stored: StoredFile, *, prefix: str = "", expires_in: int = SIGNED_SECONDS) -> FileRef:
        """A kept file's ref, its url signed again when a prefix is said."""
        return FileRef(
            ref=stored.ref,
            name=stored.name,
            media_type=stored.media_type,
            size=len(stored.content),
            url=self.signed_url(prefix, stored.scope, stored.ref, expires_in) if prefix else None,
        )

    def get(self, scope: str, ref: str, owner: Hashable) -> StoredFile:
        """A kept file, for its owner in its scope; anybody else's is not found."""
        stored = self._files.get((scope, ref))
        if stored is None or stored.owner != owner:
            raise UnknownUiFile(f"No file {ref!r} is kept here for this conversation")
        return stored

    def resolve(self, scope: str, given: FileRef | dict[str, Any], owner: Hashable) -> StoredFile:
        """The file a ref names, checked: the ref the page sends back, read as kept."""
        ref = given if isinstance(given, FileRef) else FileRef.model_validate(given)
        return self.get(scope, ref.ref, owner)

    def discard(self, scope: str) -> int:
        """Forget every file of a scope; how many."""
        gone = [key for key in self._files if key[0] == scope]
        for key in gone:
            self._kept -= len(self._files.pop(key).content)
        return len(gone)

    # --- signed urls ---------------------------------------------------------------

    def _signature(self, scope: str, ref: str, expires: int) -> str:
        message = b"".join(
            len(part).to_bytes(8, "big") + part
            for part in (b"reactor.ui.file/v1", scope.encode(), ref.encode(), str(expires).encode())
        )
        digest = hmac.new(self._secret, message, hashlib.sha256).digest()
        return base64.urlsafe_b64encode(digest).rstrip(b"=").decode()

    def signed_url(self, prefix: str, scope: str, ref: str, expires_in: int = SIGNED_SECONDS) -> str:
        """``{prefix}/{scope}/{ref}?expires=…&sig=…``: fetched without a credential, until it expires."""
        expires = int(self._clock()) + expires_in
        return (
            f"{prefix.rstrip('/')}/{quote(scope, safe='')}/{quote(ref, safe='')}"
            f"?expires={expires}&sig={self._signature(scope, ref, expires)}"
        )

    def open_signed(self, scope: str, ref: str, expires: str | int, sig: str) -> StoredFile:
        """The file a signed url names, once its signature and its time are checked."""
        try:
            when = int(expires)
        except (TypeError, ValueError):
            raise UiFileSignatureInvalid("A signed url says when it expires") from None
        if not hmac.compare_digest(self._signature(scope, ref, when), sig or ""):
            raise UiFileSignatureInvalid("This url was not signed for that file")
        if when < self._clock():
            raise UiFileSignatureInvalid("This url has expired: ask for the file again")
        stored = self._files.get((scope, ref))
        if stored is None:
            raise UnknownUiFile(f"No file {ref!r} is kept here any more")
        return stored


#: ``authenticate(token, scope)`` → the owner, sync or async; raises to refuse.
Authenticate = Callable[[str, str], Any | Awaitable[Any]]


def _bearer(request: Request) -> str:
    said = request.headers.get("authorization", "")
    scheme, _, token = said.partition(" ")
    return token.strip() if scheme.lower() == "bearer" else ""


class UiFilesRoutes:
    """The upload and the signed download a host mounts over its :class:`UiFiles`.

    ``authenticate`` names who uploads, from their credential and the scope —
    as the ui socket's does — and raises to refuse (a :class:`UiFileError`
    keeps its status, anything else is a ``401``). ``prefix`` is where the
    host mounts :meth:`download`, so the refs it answers carry signed urls.
    """

    def __init__(self, files: UiFiles, *, authenticate: Authenticate, prefix: str) -> None:
        self.files = files
        self._authenticate = authenticate
        self.prefix = prefix

    async def upload(self, request: Request) -> Response:
        """The bytes of one file as the body: its ref, as JSON."""
        scope = request.headers.get(SCOPE_HEADER, "").strip()
        name = unquote(request.headers.get(NAME_HEADER, "")).strip()
        media_type = request.headers.get("content-type", "").split(";", 1)[0].strip()
        try:
            if not scope:
                raise UiFileError(f"An upload says its conversation in {SCOPE_HEADER}")
            if not name:
                raise UiFileError(f"An upload says its file's name in {NAME_HEADER}")
            owner = await self._owner(_bearer(request), scope)
            declared = request.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > self.files.max_file:
                raise UiFileTooLarge(
                    f"{name} is {int(declared):,} bytes: a file is at most {self.files.max_file:,}"
                )
            content = bytearray()
            async for chunk in request.stream():
                content.extend(chunk)
                if len(content) > self.files.max_file:
                    raise UiFileTooLarge(f"{name} is larger than {self.files.max_file:,} bytes")
            ref = self.files.put(scope, owner, name, media_type, bytes(content), prefix=self.prefix)
        except UiFileError as refused:
            return JSONResponse({"detail": str(refused)}, status_code=refused.status_code)
        return JSONResponse(ref.model_dump(mode="json", exclude_none=True))

    async def download(self, request: Request, scope: str, ref: str) -> Response:
        """A file by its signed url: its bytes, named, never sniffed."""
        try:
            stored = self.files.open_signed(
                scope, ref, request.query_params.get("expires", ""), request.query_params.get("sig", "")
            )
        except UiFileError as refused:
            return JSONResponse({"detail": str(refused)}, status_code=refused.status_code)
        return Response(
            stored.content,
            media_type=stored.media_type,
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{quote(stored.name)}",
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "private, no-store",
            },
        )

    async def _owner(self, token: str, scope: str) -> Any:
        try:
            owner = self._authenticate(token, scope)
            if inspect.isawaitable(owner):
                owner = await owner
        except UiFileError:
            raise
        except Exception as refused:  # noqa: BLE001 - whatever the host raises refuses
            raise UiFileUnauthorized(str(refused) or "The credential was refused") from None
        return owner


__all__ = [
    "MAX_FILE_BYTES",
    "MAX_KEPT_BYTES",
    "NAME_HEADER",
    "SCOPE_HEADER",
    "SIGNED_SECONDS",
    "StoredFile",
    "UiFileError",
    "UiFileSignatureInvalid",
    "UiFileTooLarge",
    "UiFileUnauthorized",
    "UiFiles",
    "UiFilesRoutes",
    "UnknownUiFile",
]
