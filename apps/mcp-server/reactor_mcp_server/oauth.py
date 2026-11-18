# Copyright (c) 2026-Present Datalayer, Inc.
#
# BSD 3-Clause License

"""OAuth for a hosted MCP server, as contributions.

An MCP server that acts for somebody is an OAuth 2.1 *protected resource*
(the MCP authorization specification): it accepts a bearer token an
authorization server issued, says where that server is (RFC 9728), and answers
a request without a usable token with a challenge a client can follow.

Three things are contributed, and the host does the rest:

* **what the resource is** — a :class:`ProtectedResource`: its URL, its
  authorization servers, the scopes it understands;
* **what verifies a token** — the SDK's ``TokenVerifier`` or an async
  callable, several asked in order; :class:`JWTVerifier` is a ready one for
  signed tokens (issuer, audience, expiry, a JWKS or a key);
* **another way in**, when there is one — an :data:`Admission` for a server
  open to anybody (:func:`anyone`) or a deployment that also takes a key of
  its own, which answers the caller that key names.

:class:`OAuthExtension` contributes them in one line. Served by
:func:`~reactor_mcp_server.app.create_mcp_app`, the host then:

* serves the protected-resource document at
  ``/.well-known/oauth-protected-resource`` and at the path-suffixed form
  (``/.well-known/oauth-protected-resource/mcp``);
* refuses a request without a valid token with ``401`` and
  ``WWW-Authenticate: Bearer resource_metadata="…"`` (and ``scope`` when
  scopes are needed), and one whose token lacks a scope with ``403`` and
  ``error="insufficient_scope"``;
* requires the scopes a tool or its toolset declares, on each ``tools/call``;
* gives a tool handler the caller (:func:`current_access_token`).

Built on the MCP SDK's own authorization support: its ``AccessToken`` and
``TokenVerifier``, its bearer backend and auth context, its metadata model.
What is added is what the SDK leaves to its host: scopes per tool, the
``scope`` attribute of a challenge, a document that can follow the request,
and several verifiers.

@module reactor_mcp_server.oauth
"""

from __future__ import annotations

import inspect
import json
import logging
from dataclasses import dataclass, field
from typing import (
    Any,
    Awaitable,
    Callable,
    Iterable,
    Mapping,
    MutableMapping,
    Optional,
    Sequence,
    Union,
)
from urllib.parse import urlsplit

from mcp.server.auth.middleware.auth_context import (
    AuthContextMiddleware,
    auth_context_var,
    get_access_token,
)
from mcp.server.auth.middleware.bearer_auth import AuthenticatedUser, BearerAuthBackend
from mcp.server.auth.provider import AccessToken, TokenVerifier
from mcp.server.auth.routes import build_resource_metadata_url, cors_middleware
from mcp.shared.auth import ProtectedResourceMetadata
from pydantic import AnyHttpUrl
from reactor import PluginManifest
from starlette.authentication import AuthCredentials
from starlette.middleware import Middleware
from starlette.middleware.authentication import AuthenticationMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from reactor_mcp_server.extension import McpExtension

logger = logging.getLogger(__name__)

Scope = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[MutableMapping[str, Any]]]
Send = Callable[[MutableMapping[str, Any]], Awaitable[None]]

#: What verifies a bearer token: the SDK's protocol, or an async callable.
Verifier = Union[TokenVerifier, Callable[[str], Awaitable[Optional[AccessToken]]]]

#: Whether a request without a bearer token is served all the same: ``True``
#: for a caller nobody names, served where no scope is needed; an
#: ``AccessToken`` for a caller the other way in identified (the owner of a
#: key), who is then the caller, with the scopes it says.
Admitted = Union[bool, AccessToken, None]
Admission = Callable[[Scope], Union[Admitted, Awaitable[Admitted]]]

#: Where RFC 9728 puts the document, before the resource's own path.
WELL_KNOWN = "/.well-known/oauth-protected-resource"

#: The RFC 6750 error codes of a challenge.
INVALID_TOKEN = "invalid_token"
INSUFFICIENT_SCOPE = "insufficient_scope"

#: The largest ``tools/call`` body read to find which tool it names, when a
#: tool requires scopes. The SDK's own limit on a request body.
MAX_PEEKED_BODY = 4 * 1024 * 1024


# --- The resource -----------------------------------------------------------


@dataclass(frozen=True)
class ProtectedResource:
    """This MCP server, as OAuth sees it (RFC 9728)."""

    #: The server's URL, as a client is given it: ``https://mcp.example.com/mcp``.
    #: A token is issued *for* this URL (RFC 8707), so it is the public one.
    resource: str
    #: The issuers whose tokens are accepted here. At least one.
    authorization_servers: tuple[str, ...]
    #: The scopes a client may ask for.
    scopes_supported: tuple[str, ...] = ()
    #: The scopes every request needs, whatever it calls.
    required_scopes: tuple[str, ...] = ()
    #: The ``realm`` of a challenge. Empty leaves it out.
    realm: str = ""
    resource_name: str = ""
    resource_documentation: str = ""
    #: Further members of the document (``resource_policy_uri``, a member of
    #: the deployment's own), merged over what the fields above say.
    extra: Mapping[str, Any] = field(default_factory=dict)
    #: Where the document is served, when it is not where RFC 9728 §3.1 puts
    #: it for `resource` — a URL carrying a query of the deployment's own.
    metadata_url: str = ""
    #: Refuse a token the verifier does not report as issued for `resource`
    #: (``AccessToken.resource``, the RFC 8707 audience). Off when the
    #: verifier checks the audience itself, which :class:`JWTVerifier` does.
    validate_token_resource: bool = False
    #: The resource as *this request* should see it: a deployment whose URL
    #: carries something the document must repeat (the scopes it names)
    #: answers a narrowed copy. Given this resource and the ASGI scope.
    for_request: Optional[Callable[["ProtectedResource", Scope], "ProtectedResource"]] = None

    def __post_init__(self) -> None:
        parts = urlsplit(self.resource)
        if parts.scheme not in ("http", "https") or not parts.netloc or parts.fragment:
            raise ValueError(
                f"A protected resource is an http(s) URL without a fragment: {self.resource!r}"
            )
        object.__setattr__(self, "authorization_servers", tuple(self.authorization_servers))
        object.__setattr__(self, "scopes_supported", tuple(self.scopes_supported))
        object.__setattr__(self, "required_scopes", tuple(self.required_scopes))
        if not self.authorization_servers:
            raise ValueError("A protected resource names at least one authorization server")

    def at(self, scope: Optional[Scope]) -> "ProtectedResource":
        """This resource as the request in `scope` sees it."""
        if self.for_request is None or scope is None:
            return self
        return self.for_request(self, scope)

    @property
    def well_known_url(self) -> str:
        """Where the document is: what a challenge's ``resource_metadata`` says."""
        if self.metadata_url:
            return self.metadata_url
        bare = urlsplit(self.resource)._replace(query="").geturl()
        return str(build_resource_metadata_url(AnyHttpUrl(bare)))

    def document(self) -> dict[str, Any]:
        """The RFC 9728 document, checked by the SDK's model of it."""
        # Validated from plain strings, so the model's own reading of a URL
        # applies: an issuer without a path keeps no trailing slash, and an
        # issuer is compared character for character.
        metadata = ProtectedResourceMetadata.model_validate(
            {
                "resource": self.resource,
                "authorization_servers": list(self.authorization_servers),
                "scopes_supported": list(self.scopes_supported) or None,
                "resource_name": self.resource_name or None,
                "resource_documentation": self.resource_documentation or None,
            }
        )
        return {**metadata.model_dump(mode="json", exclude_none=True), **dict(self.extra)}

    def paths(self) -> tuple[str, ...]:
        """The paths the document is served at: the path-suffixed one RFC 9728
        §3.1 defines for this resource, and the root one a client tries next."""
        suffix = urlsplit(self.resource).path
        suffixed = WELL_KNOWN + ("" if suffix in ("", "/") else suffix)
        return tuple(dict.fromkeys((WELL_KNOWN, suffixed)))

    def routes(self) -> list[Route]:
        """The routes serving the document, for any Starlette application."""

        async def metadata(request: Request) -> Response:
            # A document that follows the request is not one to keep for an hour.
            headers = {} if self.for_request else {"Cache-Control": "public, max-age=3600"}
            return JSONResponse(self.at(request.scope).document(), headers=headers)

        endpoint = cors_middleware(metadata, ["GET", "OPTIONS"])
        return [Route(path, endpoint=endpoint, methods=["GET", "OPTIONS"]) for path in self.paths()]


# --- The challenge ----------------------------------------------------------


def _quoted(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def challenge(
    resource: ProtectedResource,
    *,
    error: str = "",
    description: str = "",
    scopes: Iterable[str] = (),
) -> str:
    """The ``WWW-Authenticate`` value that tells a client where to get a token.

    ``resource_metadata`` (RFC 9728 §5.1) is what turns a refusal into the
    start of a flow: a client reads the document, finds the authorization
    server and signs in. ``scope`` names what the request needs (RFC 6750
    §3.1). No ``error`` when the request carried no token at all, as RFC 6750
    asks: nothing was wrong with what it did not send.
    """
    parts = []
    if resource.realm:
        parts.append(f'realm="{_quoted(resource.realm)}"')
    if error:
        parts.append(f'error="{_quoted(error)}"')
    if description:
        parts.append(f'error_description="{_quoted(description)}"')
    named = " ".join(dict.fromkeys(scopes))
    if named:
        parts.append(f'scope="{_quoted(named)}"')
    parts.append(f'resource_metadata="{resource.well_known_url}"')
    return "Bearer " + ", ".join(parts)


def with_challenge(
    headers: Iterable[tuple[bytes, bytes]], resource: ProtectedResource
) -> list[tuple[bytes, bytes]]:
    """Response headers whose challenge names the document.

    One that already does is kept; one that does not (the SDK's own
    ``Bearer error="invalid_token"``) gains ``resource_metadata``; and without
    any, one is added.
    """
    parameter = f'resource_metadata="{resource.well_known_url}"'
    updated: list[tuple[bytes, bytes]] = []
    seen = False
    for name, value in headers:
        if name.lower() == b"www-authenticate":
            seen = True
            text = value.decode("latin-1")
            if "resource_metadata=" not in text:
                value = f"{text}, {parameter}".encode("latin-1")
        updated.append((name, value))
    if not seen:
        updated.append((b"www-authenticate", challenge(resource).encode("latin-1")))
    return updated


async def refuse(
    send: Send,
    resource: ProtectedResource,
    *,
    status: int = 401,
    error: str = "",
    description: str = "Authentication required",
    scopes: Iterable[str] = (),
) -> None:
    """Answer an ASGI request with the challenge, and the error as JSON.

    The body is the SDK's (``error``, ``error_description``): a client that
    does not read ``WWW-Authenticate`` still reads why.
    """
    body = json.dumps(
        {"error": error or INVALID_TOKEN, "error_description": description}
    ).encode()
    header = challenge(
        resource, error=error, description=description if error else "", scopes=scopes
    )
    await send(
        {
            "type": "http.response.start",
            "status": status,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
                (b"www-authenticate", header.encode("latin-1")),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


class ChallengeMiddleware:
    """Keep the challenge on every ``401`` that leaves an application.

    Whatever answered it — this module, the SDK's own authentication on a
    server built with one, a route of the deployment's — a client is told
    where the document is. For an application that is not
    :func:`~reactor_mcp_server.app.create_mcp_app`'s too: a gateway in front
    of MCP servers wraps what it forwards to with this.
    """

    def __init__(self, app: Any, resource: ProtectedResource) -> None:
        self.app = app
        self.resource = resource

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_challenge(message: MutableMapping[str, Any]) -> None:
            if message.get("type") == "http.response.start" and message.get("status") == 401:
                message = dict(
                    message,
                    headers=with_challenge(
                        message.get("headers") or [], self.resource.at(scope)
                    ),
                )
            await send(message)

        await self.app(scope, receive, send_with_challenge)


# --- Verifying --------------------------------------------------------------


class _Verifiers:
    """Several verifiers as one: asked in order, the first that knows answers."""

    def __init__(self, verifiers: Sequence[Verifier]) -> None:
        self.verifiers = tuple(verifiers)

    async def verify_token(self, token: str) -> Optional[AccessToken]:
        for verifier in self.verifiers:
            verify = getattr(verifier, "verify_token", verifier)
            found = await verify(token)
            if found is not None:
                return found
        return None


def as_verifier(verifiers: Sequence[Verifier]) -> TokenVerifier:
    """One ``TokenVerifier`` out of what was contributed."""
    for verifier in verifiers:
        if not callable(getattr(verifier, "verify_token", verifier)):
            raise ValueError(
                f"{verifier!r} verifies no token: a verifier has `verify_token` or is "
                "an async callable taking the token"
            )
    return _Verifiers(verifiers)


class JWTVerifier:
    """Verify a signed JWT access token: signature, issuer, audience, expiry.

    The key comes from the issuer's JWKS (``jwks_uri``, fetched once and kept,
    read again when a token names a key not seen yet) or is given (``key``, a
    PEM public key or a shared secret — name its ``algorithms`` then).

    The audience is checked here: a token issued for another resource is not
    one for this server (RFC 8707), and accepting it would let whoever holds a
    token for one service of an issuer call every other. A token bound to a
    key (``cnf``, RFC 9449) is refused as a bearer, since presenting it
    without its proof is what binding exists to prevent.

    Needs PyJWT: ``pip install "reactor_mcp_server[oauth]"``.
    """

    def __init__(
        self,
        *,
        issuer: str,
        audience: Union[str, Iterable[str]],
        jwks_uri: str = "",
        key: Any = None,
        algorithms: Iterable[str] = ("RS256", "ES256"),
        leeway: float = 30.0,
        scope_claim: str = "scope",
        client_id_claims: Iterable[str] = ("client_id", "azp"),
    ) -> None:
        try:
            import jwt  # noqa: PLC0415
        except ImportError as error:  # pragma: no cover - the extra says so
            raise ImportError(
                'JWTVerifier needs PyJWT: pip install "reactor_mcp_server[oauth]"'
            ) from error
        if bool(jwks_uri) == (key is not None):
            raise ValueError("A JWT is verified with a `jwks_uri` or a `key`: name one")
        self._jwt = jwt
        self.issuer = issuer
        self.audiences = (audience,) if isinstance(audience, str) else tuple(audience)
        if not issuer or not self.audiences:
            raise ValueError("A JWT verifier checks an issuer and an audience: name both")
        self.algorithms = tuple(algorithms)
        self.leeway = leeway
        self.scope_claim = scope_claim
        self.client_id_claims = tuple(client_id_claims)
        self._key = key
        self._jwks = jwt.PyJWKClient(jwks_uri, cache_keys=True) if jwks_uri else None

    @classmethod
    def for_resource(cls, resource: ProtectedResource, **options: Any) -> "JWTVerifier":
        """A verifier of the tokens `resource`'s first authorization server
        issues for it."""
        return cls(
            issuer=resource.authorization_servers[0],
            audience=urlsplit(resource.resource)._replace(query="").geturl(),
            **options,
        )

    def _claims(self, token: str) -> Optional[dict[str, Any]]:
        jwt = self._jwt
        try:
            key = self._key
            if self._jwks is not None:
                key = self._jwks.get_signing_key_from_jwt(token).key
            return jwt.decode(
                token,
                key,
                algorithms=list(self.algorithms),
                issuer=self.issuer,
                audience=list(self.audiences),
                leeway=self.leeway,
                options={"require": ["exp", "iss", "aud"]},
            )
        except jwt.PyJWTError as error:
            # PyJWKClientError is one too: an unknown key is an unknown token.
            logger.debug("A bearer token was refused: %s", error)
            return None

    async def verify_token(self, token: str) -> Optional[AccessToken]:
        import anyio  # noqa: PLC0415

        # In a thread: reading a JWKS is a blocking fetch, and a signature
        # check is not something to hold the loop for either.
        claims = await anyio.to_thread.run_sync(self._claims, token)
        if claims is None:
            return None
        if claims.get("cnf"):
            logger.debug("A key-bound token was presented as a bearer and refused")
            return None
        granted = claims.get(self.scope_claim) or ()
        scopes = granted.split() if isinstance(granted, str) else [str(item) for item in granted]
        audience = claims.get("aud")
        named = [audience] if isinstance(audience, str) else list(audience or ())
        subject = str(claims.get("sub") or "")
        client_id = next(
            (str(claims[name]) for name in self.client_id_claims if claims.get(name)), subject
        )
        return AccessToken(
            token=token,
            client_id=client_id,
            scopes=scopes,
            expires_at=int(claims["exp"]),
            resource=next((item for item in self.audiences if item in named), None),
            subject=subject or None,
            claims=claims,
        )


def current_access_token() -> Optional[AccessToken]:
    """The verified token of the request being served, for a tool handler.

    Its ``subject`` is who the caller is, ``client_id`` which client acts for
    them, ``scopes`` what they allowed and ``claims`` whatever else the
    verifier kept. ``None`` for a request admitted without one, and wherever
    nothing authenticates the caller. The SDK's ``get_access_token``.
    """
    return get_access_token()


# --- What a host serves with ------------------------------------------------


@dataclass(frozen=True)
class OAuth:
    """What was contributed, put together: read with ``McpHost.oauth()``."""

    resource: ProtectedResource
    verifier: TokenVerifier
    admissions: tuple[Admission, ...] = ()

    def middleware(self) -> list[Middleware]:
        """The SDK's authentication, for a Starlette application: the bearer
        token read and verified (not yet required), and the caller kept for
        the handlers."""
        return [
            Middleware(
                AuthenticationMiddleware,
                backend=BearerAuthBackend(
                    self.verifier,
                    resource_server_url=(
                        AnyHttpUrl(self.resource.resource)
                        if self.resource.validate_token_resource
                        else None
                    ),
                ),
            ),
            Middleware(AuthContextMiddleware),
        ]

    async def admitted(self, scope: Scope) -> Admitted:
        """How a request without a token comes in: as the caller an admission
        names, as nobody in particular (``True``), or not at all."""
        anonymous = False
        for admission in self.admissions:
            answer = admission(scope)
            if inspect.isawaitable(answer):
                answer = await answer
            if isinstance(answer, AccessToken):
                return answer
            anonymous = anonymous or bool(answer)
        return anonymous


#: The scopes a ``tools/call`` of this name needs on this request, or ``None``
#: when no tool of the server it reaches requires any (nothing is read then).
ToolScopes = Callable[[Scope], Optional[Mapping[str, Sequence[str]]]]


def _bearer(scope: Scope) -> str:
    for name, value in scope.get("headers") or []:
        if name.lower() == b"authorization":
            text = value.decode("latin-1")
            if text.lower().startswith("bearer "):
                return text[7:].strip()
    return ""


class RequireBearer:
    """Serve an application only to a caller with a valid token, or admitted.

    After the SDK's authentication (:meth:`OAuth.middleware`), which put the
    verified caller in the scope. What it refuses, it refuses the way RFC 6750
    and the MCP authorization specification say:

    * no token, and nothing admits the request (or it needs a scope and
      nobody says who is asking) — ``401``, a challenge with no error, naming
      the scopes needed;
    * a token that is not valid here — ``401``, ``invalid_token``;
    * a valid token without a scope the request needs — ``403``,
      ``insufficient_scope``, naming them.

    The scopes needed are the resource's ``required_scopes`` and, for a
    ``tools/call``, those of the tool and its toolset.
    """

    def __init__(
        self,
        app: Any,
        oauth: OAuth,
        *,
        tool_scopes: Optional[ToolScopes] = None,
        max_body: int = MAX_PEEKED_BODY,
    ) -> None:
        self.app = app
        self.oauth = oauth
        self.tool_scopes = tool_scopes
        self.max_body = max_body

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        resource = self.oauth.resource.at(scope)
        needed = list(resource.required_scopes)
        by_tool = self.tool_scopes(scope) if self.tool_scopes is not None else None
        if by_tool and scope.get("method") == "POST":
            body, receive = await self._peeked(receive)
            if body is None:
                await _too_large(send)
                return
            needed += [item for item in by_tool.get(_tool_called(body), ()) if item not in needed]

        user = scope.get("user")
        admitted_as: Optional[AuthenticatedUser] = None
        if not isinstance(user, AuthenticatedUser):
            admitted = await self.oauth.admitted(scope)
            if isinstance(admitted, AccessToken):
                # Another way in that says who came in: the caller from here
                # on, held to the scopes it was admitted with.
                user = admitted_as = AuthenticatedUser(admitted)
                scope["user"] = user
                scope["auth"] = AuthCredentials(admitted.scopes)
            elif _bearer(scope):
                await refuse(
                    send,
                    resource,
                    error=INVALID_TOKEN,
                    description="The access token is expired, revoked or not valid here",
                )
                return
            elif admitted and not needed:
                await self.app(scope, receive, send)
                return
            else:
                await refuse(send, resource, scopes=needed)
                return

        missing = [item for item in needed if item not in user.scopes]
        if missing:
            await refuse(
                send,
                resource,
                status=403,
                error=INSUFFICIENT_SCOPE,
                description=f"Required scope: {' '.join(missing)}",
                scopes=needed,
            )
            return
        if admitted_as is None:
            await self.app(scope, receive, send)
            return
        kept = auth_context_var.set(admitted_as)
        try:
            await self.app(scope, receive, send)
        finally:
            auth_context_var.reset(kept)

    async def _peeked(self, receive: Receive) -> tuple[Optional[bytes], Receive]:
        """The request's body, and a `receive` that gives it again."""
        chunks: list[bytes] = []
        size = 0
        while True:
            message = await receive()
            if message["type"] != "http.request":
                # The client went away: let the application hear it.
                async def gone(first: MutableMapping[str, Any] = message) -> MutableMapping[str, Any]:
                    return first

                return b"", gone
            chunk = message.get("body") or b""
            size += len(chunk)
            if size > self.max_body:
                return None, receive
            chunks.append(chunk)
            if not message.get("more_body"):
                break
        body = b"".join(chunks)
        replayed = False

        async def again() -> MutableMapping[str, Any]:
            nonlocal replayed
            if not replayed:
                replayed = True
                return {"type": "http.request", "body": body, "more_body": False}
            return await receive()

        return body, again


def _tool_called(body: bytes) -> str:
    """The tool a JSON-RPC ``tools/call`` names, or ``""`` for anything else."""
    try:
        message = json.loads(body)
    except ValueError:
        return ""
    if not isinstance(message, dict) or message.get("method") != "tools/call":
        return ""
    params = message.get("params")
    name = params.get("name") if isinstance(params, dict) else ""
    return name if isinstance(name, str) else ""


async def _too_large(send: Send) -> None:
    body = b'{"error": "request_too_large"}'
    await send(
        {
            "type": "http.response.start",
            "status": 413,
            "headers": [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body)).encode()),
            ],
        }
    )
    await send({"type": "http.response.body", "body": body})


# --- The extension ----------------------------------------------------------


class OAuthExtension(McpExtension):
    """OAuth on a host, in one extension.

    ::

        resource = ProtectedResource(
            resource="https://mcp.example.com/mcp",
            authorization_servers=("https://auth.example.com",),
            scopes_supported=("notes:read", "notes:write"),
        )
        host = build_host([
            Notes(),
            OAuthExtension(
                resource,
                verifier=JWTVerifier.for_resource(
                    resource, jwks_uri="https://auth.example.com/jwks"
                ),
            ),
        ])

    An extension of the deployment's own may contribute any of the three
    instead (``protected_resources``, ``token_verifiers``, ``admissions``),
    and a second one may add a verifier to what this one configured.
    """

    def __init__(
        self,
        resource: Optional[ProtectedResource] = None,
        *,
        verifier: Union[Verifier, Sequence[Verifier], None] = None,
        admits: Union[Admission, Sequence[Admission], None] = None,
        name: str = "oauth",
    ) -> None:
        self._resource = resource
        self._verifiers = _several(verifier)
        self._admissions = _several(admits)
        self._name = name

    def manifest(self) -> PluginManifest:
        from reactor_mcp_server import __version__  # noqa: PLC0415

        return PluginManifest(name=self._name, version=__version__)

    def toolsets(self) -> Sequence[Any]:
        # It offers no tool, so it declares no toolset to list.
        return ()

    def protected_resources(self) -> Sequence[ProtectedResource]:
        return () if self._resource is None else (self._resource,)

    def token_verifiers(self) -> Sequence[Verifier]:
        return self._verifiers

    def admissions(self) -> Sequence[Admission]:
        return self._admissions


def _several(value: Any) -> tuple[Any, ...]:
    if value is None:
        return ()
    if isinstance(value, (list, tuple)):
        return tuple(value)
    return (value,)


def anyone(scope: Scope) -> bool:
    """An :data:`Admission` for a server open to anybody: a caller with a
    token is known, and one without is served."""
    return True


__all__ = [
    "INSUFFICIENT_SCOPE",
    "INVALID_TOKEN",
    "AccessToken",
    "Admission",
    "Admitted",
    "ChallengeMiddleware",
    "JWTVerifier",
    "OAuth",
    "OAuthExtension",
    "ProtectedResource",
    "RequireBearer",
    "TokenVerifier",
    "Verifier",
    "anyone",
    "as_verifier",
    "challenge",
    "current_access_token",
    "refuse",
    "with_challenge",
]
