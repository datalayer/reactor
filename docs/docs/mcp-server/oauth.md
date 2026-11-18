---
sidebar_position: 6
title: OAuth
---

# OAuth

An MCP server that acts for somebody is an OAuth 2.1 **protected resource**:
it accepts a bearer token an authorization server issued, says where that
server is, and answers a request without a usable token with a challenge a
client can follow into a sign-in. That is the [MCP authorization
specification](https://modelcontextprotocol.io/specification/latest/basic/authorization),
and since 1.3.8 a host is given it the way it is given everything else: as
contributions.

```bash
pip install "reactor_mcp_server[oauth]"
```

```python
from reactor_mcp_server import (
    JWTVerifier,
    OAuthExtension,
    ProtectedResource,
    build_host,
    create_mcp_app,
)

resource = ProtectedResource(
    resource="https://mcp.example.com/mcp",
    authorization_servers=("https://auth.example.com",),
    scopes_supported=("notes:read", "notes:write"),
)

host = build_host([
    Notes(),
    OAuthExtension(
        resource,
        verifier=JWTVerifier.for_resource(resource, jwks_uri="https://auth.example.com/jwks"),
    ),
])
app = create_mcp_app(host, path="/mcp")
```

Nothing else changes. `create_mcp_app` reads what was contributed and serves
the host as a protected resource:

| What | How |
| --- | --- |
| `GET /.well-known/oauth-protected-resource/mcp` | The [RFC 9728](https://www.rfc-editor.org/rfc/rfc9728) document: `resource`, `authorization_servers`, `scopes_supported`, `bearer_methods_supported`. Also at `/.well-known/oauth-protected-resource`, which a client tries next. Open, with CORS |
| A request without a token | `401`, `WWW-Authenticate: Bearer resource_metadata="…"`, with `scope="…"` when the request needs scopes |
| A token that is expired, revoked or not for this server | `401`, `error="invalid_token"` |
| A token without a scope the request needs | `403`, `error="insufficient_scope"`, `scope="…"` |
| `/healthz` | Open |
| `/toolsets` | Needs a token, unless `create_mcp_app(..., public_toolsets=True)` |

It is built on the MCP SDK's own authorization support — its `AccessToken` and
`TokenVerifier`, its bearer backend and auth context, its metadata model. What
is added is what the SDK leaves to a host: scopes per tool, the `scope` of a
challenge, a document that can follow the request, several verifiers, and
another way in.

## Three contribution points

| Point | Contributions | An extension offers them with |
| --- | --- | --- |
| `mcp.auth.resources` | `ProtectedResource`: what this server is. Exactly one per host | `protected_resources()` |
| `mcp.auth.verifiers` | The SDK's `TokenVerifier`, or an async callable taking the token. Asked in order; the first that knows the token answers | `token_verifiers()` |
| `mcp.auth.admissions` | Callables taking the ASGI scope: another way in than a bearer token | `admissions()` |

`OAuthExtension` contributes all three from its arguments. An extension of
your own may contribute any of them instead — the deployment's extension that
already knows its URL and its issuer — and a second extension may add a
verifier to what the first configured:

```python
class Keys(McpExtension):
    """This deployment also takes its own long-lived keys."""

    def manifest(self) -> PluginManifest:
        return PluginManifest(name="keys", version="1.0.0")

    def toolsets(self):
        return ()

    def token_verifiers(self):
        return (self.verify,)

    async def verify(self, token: str) -> AccessToken | None:
        owner = await lookup(token)
        if owner is None:
            return None  # not one of ours: the next verifier is asked
        return AccessToken(token=token, client_id="key", scopes=["notes:read"], subject=owner)
```

Half of it is refused when the application is created rather than served: a
resource nobody verifies tokens for would send every client into a sign-in
whose token is then refused, and a verifier without a resource would refuse
callers without telling them where to get a token.

## Verifying a token

A verifier answers the SDK's `AccessToken` — who (`subject`), through which
client (`client_id`), allowed what (`scopes`), for which resource
(`resource`), until when (`expires_at`) — or `None` to refuse.

`JWTVerifier` is the ready one for signed tokens:

```python
JWTVerifier(
    issuer="https://auth.example.com",
    audience="https://mcp.example.com/mcp",
    jwks_uri="https://auth.example.com/jwks",   # or key=<a PEM public key>
)
```

It checks the signature (the key read from the issuer's JWKS and kept, read
again when a token names a key not seen yet), the issuer, the expiry and the
**audience**. The audience is not optional: a token issued for another service
of the same issuer is not a token for this server
([RFC 8707](https://www.rfc-editor.org/rfc/rfc8707)), and a server that
accepts any audience lets whoever holds a token for one service call all of
them. A token bound to a key (`cnf`,
[RFC 9449](https://www.rfc-editor.org/rfc/rfc9449)) is refused as a bearer.

A verifier that asks the authorization server (introspection), or that knows
credentials no standard describes, is a class with `verify_token` — the
platform-specific part of a deployment lives there, and nowhere in the host.
One that does not check the audience itself sets `AccessToken.resource` and
turns on `ProtectedResource(validate_token_resource=True)`: the SDK's bearer
backend then refuses a token whose resource is not this server.

## Scopes

A tool says what it requires, and so does a toolset; a call needs both:

```python
class Notes(McpExtension):
    def toolsets(self):
        return (Toolset(name="notes", scopes=("notes:read",)),)

    @tool()
    async def list_notes(self) -> list[str]: ...

    @tool(scopes=("notes:write",))
    async def write_note(self, text: str) -> str: ...
```

`tools/call write_note` with a token that has only `notes:read` is answered
`403` before it reaches the server:

```http
HTTP/1.1 403 Forbidden
WWW-Authenticate: Bearer error="insufficient_scope", error_description="Required scope: notes:write", scope="notes:read notes:write", resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"
```

which is what a client needs to ask for the missing scope and try again.
`ProtectedResource(required_scopes=...)` names scopes every request needs,
whatever it calls.

A deployment can require more of a caller than a tool's author did, [by
name](/mcp-server/extending-a-tool) — more, never less:

```python
def tool_extensions(self):
    return (("launch_sandbox", ToolExtension(scopes=("sandboxes:manage",))),)
```

`host.required_scopes(selection)` answers what each tool of a selection
requires. Scopes are consulted where a caller is authenticated: over stdio, or
on a host without OAuth, they are declared and nothing reads them.

## Who is calling, in a handler

```python
from reactor_mcp_server import current_access_token

@tool()
async def list_notes(self) -> list[str]:
    caller = current_access_token()
    return await notes_of(caller.subject)
```

The verified `AccessToken` of the request being served — the SDK's
`get_access_token` — or `None` for a request that came in without one.

## Another way in

Authorization is optional in MCP, and a deployment may serve some callers
without a token. An admission says which:

```python
from reactor_mcp_server.oauth import anyone

OAuthExtension(resource, verifier=verifier, admits=anyone)
```

`anyone` makes the server open: a caller with a token is known, a caller
without one is served — where no scope is needed. A tool that requires a
scope still answers `401` with the scope it needs, which is how a client
learns that *this* call wants a sign-in. A token that is wrong is refused as
`invalid_token`, open server or not.

An admission that knows who came in answers an `AccessToken`, and that is the
caller from there on, held to the scopes it says:

```python
async def by_key(scope) -> AccessToken | None:
    key = dict(scope["headers"]).get(b"x-api-key", b"").decode()
    owner = await owner_of(key) if key else None
    if owner is None:
        return None
    return AccessToken(token=key, client_id="key", scopes=["notes:read"], subject=owner)
```

## A document that follows the request

Most resources are one document. A deployment whose URL carries something the
document has to repeat — scopes named in the query, a tenant — answers a
narrowed copy for the request:

```python
def narrowed(resource: ProtectedResource, scope) -> ProtectedResource:
    named = scopes_in(scope["query_string"])
    if not named:
        return resource
    return replace(
        resource,
        resource=f"{resource.resource}?scopes={','.join(named)}",
        scopes_supported=named,
        metadata_url=f"{resource.well_known_url}?scopes={','.join(named)}",
    )

ProtectedResource(..., for_request=narrowed)
```

The document route and every challenge then read the resource through it.

## In an application that is not `create_mcp_app`'s

A gateway in front of MCP servers, or a REST API beside one, is the same
protected resource and should say so the same way. The parts are usable on
their own:

```python
from reactor_mcp_server.oauth import ChallengeMiddleware, challenge, refuse

app.router.routes.extend(resource.routes())          # the document, any Starlette app
app = ChallengeMiddleware(app, resource)             # every 401 names the document
headers = {"WWW-Authenticate": challenge(resource)}  # a refusal of your own
await refuse(send, resource)                         # the 401, as ASGI
```

## From the command line

```bash
reactor-mcp-server \
  --oauth-resource https://mcp.example.com/mcp \
  --oauth-issuer https://auth.example.com \
  --oauth-jwks-uri https://auth.example.com/jwks \
  --oauth-scopes "notes:read notes:write"
```

| Option | What it is |
| --- | --- |
| `--oauth-resource` / `REACTOR_MCP_OAUTH_RESOURCE` | This server's public URL. With the two below, serves it as a protected resource |
| `--oauth-issuer` / `REACTOR_MCP_OAUTH_ISSUER` | The authorization server whose tokens are accepted |
| `--oauth-jwks-uri` / `REACTOR_MCP_OAUTH_JWKS_URI` | Where it publishes its signing keys |
| `--oauth-scopes` / `REACTOR_MCP_OAUTH_SCOPES` | The scopes a client may ask for |
| `--oauth-required-scopes` / `REACTOR_MCP_OAUTH_REQUIRED_SCOPES` | The scopes every request needs |

Over stdio nothing authenticates a caller, and the options are not read.
