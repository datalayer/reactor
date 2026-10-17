---
sidebar_position: 6.5
title: Files
---

# Files as references

A file never rides inside JSON — not in an op, not in a press, not in the
host's run. The page uploads its bytes first and gets a `FileRef` back; what
it sends afterwards names the ref. The host reads the bytes back from the
ref, for whoever uploaded them in that conversation only.

| Tier | Import | What it holds |
| --- | --- | --- |
| Python | `reactor.ui.files` | `UiFiles` (files by scope and ref, for their owner, signed urls), `UiFilesRoutes` (the upload and the signed download a host mounts) |
| TypeScript | `@datalayer/reactor/ui` | `uploadFile`, `isFileRef`, `UiUpload`, `UiFileRefused` |
| React | `@datalayer/reactor/ui/react` | a renderer's `upload` prop, beside `act` |

## The upload

One `POST` per file, its bytes the body:

| Header | What it says |
| --- | --- |
| `Authorization` | `Bearer <credential>`, checked by the host's `authenticate(token, scope)` — the ui socket's — which names the owner |
| `X-Reactor-Scope` | The conversation the file belongs to |
| `X-Reactor-File-Name` | Its name, percent-encoded |
| `Content-Type` | Its media type |

The answer is the ref — `{ref, name, media_type, size, url}` — whose `url`
is a **signed**, short-lived path (`{prefix}/{scope}/{ref}?expires=…&sig=…`,
five minutes by default) the page may fetch the file from without its
credential. The signature says this scope, this ref and this expiry, and
nothing else.

```python
from reactor.ui.files import UiFiles, UiFilesRoutes

files = UiFiles(secret)                      # 25 MB a file, 256 MB in all, oldest first out
routes = UiFilesRoutes(files, authenticate=authenticate, prefix="/api/files")

@app.post("/api/files")
async def upload(request): return await routes.upload(request)

@app.get("/api/files/{scope}/{ref}")
async def download(scope: str, ref: str, request): return await routes.download(request, scope, ref)

# What the page sends back: the ref, read for its owner in its scope.
stored = files.resolve(scope, ref, owner)    # .name, .media_type, .content
```

```ts
import { uploadFile } from '@datalayer/reactor/ui';

const ref = await uploadFile(chosen, { url: '/api/files', scope: thread, token });
act({ action: ANSWER_ACTION, payload: { value: ref } });
```

## Refusals

| Status | When |
| --- | --- |
| `400` | An upload without its scope or its name |
| `401` | The credential refused |
| `403` | A download whose signature does not match, or whose time is up |
| `404` | A ref not kept here — another scope's, another owner's, or forgotten to make room |
| `413` | A file larger than the store takes |

A download is sent as an attachment, `nosniff`, never cached.
