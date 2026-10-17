# Copyright (c) 2026-Present Datalayer, Inc.
#
# BSD 3-Clause License

"""Files as references (REACTOR_UI P6, RU-6): uploaded once, named after by
their ref, read back only by their owner in their scope, fetched by a signed
url until it expires; no bytes in JSON."""

from __future__ import annotations

from typing import Any
from urllib.parse import quote

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from reactor.ui import FileRef
from reactor.ui.files import (
    NAME_HEADER,
    SCOPE_HEADER,
    UiFiles,
    UiFileSignatureInvalid,
    UiFilesRoutes,
    UiFileTooLarge,
    UnknownUiFile,
)

SECRET = b"s" * 32


class Clock:
    def __init__(self) -> None:
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now


def test_a_file_is_its_owners_in_its_scope() -> None:
    files = UiFiles(SECRET)
    ref = files.put("thread-1", ("person", "ada"), "orders.csv", "text/csv", b"a,b\n")
    assert ref == FileRef(ref=ref.ref, name="orders.csv", media_type="text/csv", size=4)
    assert files.get("thread-1", ref.ref, ("person", "ada")).content == b"a,b\n"
    assert files.resolve("thread-1", ref.model_dump(), ("person", "ada")).name == "orders.csv"
    for scope, owner in (("thread-2", ("person", "ada")), ("thread-1", ("person", "bob"))):
        with pytest.raises(UnknownUiFile) as missing:
            files.get(scope, ref.ref, owner)
        assert missing.value.status_code == 404
    assert files.discard("thread-1") == 1
    with pytest.raises(UnknownUiFile):
        files.get("thread-1", ref.ref, ("person", "ada"))


def test_a_file_too_large_is_refused_and_the_oldest_make_room() -> None:
    files = UiFiles(SECRET, max_file=4, max_kept=8)
    with pytest.raises(UiFileTooLarge) as large:
        files.put("t", "ada", "big.bin", "", b"12345")
    assert large.value.status_code == 413
    first = files.put("t", "ada", "a", "", b"1234")
    second = files.put("t", "ada", "b", "", b"1234")
    third = files.put("t", "ada", "c", "", b"1234")
    with pytest.raises(UnknownUiFile):
        files.get("t", first.ref, "ada")
    assert files.get("t", second.ref, "ada").media_type == "application/octet-stream"
    assert files.get("t", third.ref, "ada").name == "c"
    with pytest.raises(ValueError):
        UiFiles(b"short")


def test_a_signed_url_answers_until_it_expires_and_for_nothing_else() -> None:
    clock = Clock()
    files = UiFiles(SECRET, clock=clock)
    ref = files.put("thread-1", "ada", "a.txt", "text/plain", b"hi", prefix="/files", expires_in=60)
    assert ref.url is not None and ref.url.startswith(f"/files/thread-1/{quote(ref.ref, safe='')}?expires=1060&sig=")
    sig = ref.url.split("sig=")[1]
    assert files.open_signed("thread-1", ref.ref, "1060", sig).content == b"hi"
    for scope, expires, signature in (
        ("thread-2", "1060", sig),
        ("thread-1", "1061", sig),
        ("thread-1", "1060", sig[:-2] + "xx"),
        ("thread-1", "soon", sig),
    ):
        with pytest.raises(UiFileSignatureInvalid) as wrong:
            files.open_signed(scope, ref.ref, expires, signature)
        assert wrong.value.status_code == 403
    clock.now = 1_061.0
    with pytest.raises(UiFileSignatureInvalid, match="expired"):
        files.open_signed("thread-1", ref.ref, "1060", sig)


def served(files: UiFiles) -> TestClient:
    def authenticate(token: str, scope: str) -> Any:
        if token != "ada-token":
            raise PermissionError("Not signed in")
        return ("person", "ada")

    routes = UiFilesRoutes(files, authenticate=authenticate, prefix="/files")
    app = FastAPI()

    @app.post("/files")
    async def upload(request: Request) -> Any:
        return await routes.upload(request)

    @app.get("/files/{scope}/{ref}")
    async def download(scope: str, ref: str, request: Request) -> Any:
        return await routes.download(request, scope, ref)

    return TestClient(app)


def test_the_routes_upload_the_bytes_and_hand_them_back_signed() -> None:
    files = UiFiles(SECRET, max_file=16)
    client = served(files)
    headers = {
        "Authorization": "Bearer ada-token",
        SCOPE_HEADER: "thread-1",
        NAME_HEADER: quote("réponse 1.csv"),
        "Content-Type": "text/csv",
    }
    answered = client.post("/files", content=b"a,b\n1,2\n", headers=headers)
    assert answered.status_code == 200, answered.text
    ref = FileRef.model_validate(answered.json())
    assert (ref.name, ref.media_type, ref.size) == ("réponse 1.csv", "text/csv", 8)
    assert files.get("thread-1", ref.ref, ("person", "ada")).content == b"a,b\n1,2\n"
    fetched = client.get(ref.url or "")
    assert fetched.status_code == 200
    assert fetched.content == b"a,b\n1,2\n"
    assert fetched.headers["content-type"].startswith("text/csv")
    assert fetched.headers["x-content-type-options"] == "nosniff"
    assert "attachment" in fetched.headers["content-disposition"]
    # Every refusal said, with its status.
    assert client.get((ref.url or "").replace("sig=", "sig=x")).status_code == 403
    assert client.post("/files", content=b"x", headers={**headers, "Authorization": "Bearer bob"}).status_code == 401
    assert client.post("/files", content=b"x", headers={k: v for k, v in headers.items() if k != SCOPE_HEADER}).status_code == 400
    assert client.post("/files", content=b"x", headers={**headers, NAME_HEADER: ""}).status_code == 400
    large = client.post("/files", content=b"x" * 17, headers=headers)
    assert (large.status_code, large.json()["detail"]) == (413, "réponse 1.csv is 17 bytes: a file is at most 16")
