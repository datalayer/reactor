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
from mcp.server.auth.routes import cors_middleware
from mcp.shared.auth import ProtectedResourceMetadata
from pydantic import AnyHttpUrl
from reactor import PluginManifest
from starlette.authentication import AuthCredentials, AuthenticationError
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
        # Written as it is published. A token's audience and an issuer are
        # compared character for character, so a URL the document would
        # publish differently (a capital in its host, a default port) is one
        # a verifier and a client would not agree on.
        published = self.document()
        if published["resource"] != self.resource or published["authorization_servers"] != list(
            self.authorization_servers
        ):
            raise ValueError(
                "A protected resource and its authorization servers are written as "
                f"published: {published['resource']!r}, {published['authorization_servers']!r}"
            )

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
        parts = urlsplit(self.resource)
        # Without a trailing slash, which is where clients look for it
        # whichever way the resource's own path ends.
        return f"{parts.scheme}://{parts.netloc}{WELL_KNOWN}{parts.path.rstrip('/')}"

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
        # With the resource's path as written and without its trailing slash:
        # RFC 9728 inserts the path as it is, and clients commonly strip it.
        return tuple(dict.fromkeys((WELL_KNOWN, WELL_KNOWN + suffix.rstrip("/"), WELL_KNOWN + suffix)))

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


class Forbidden(AuthenticationError):
    """The caller is known, and may not come in here.

    Raised by a verifier or an admission that recognised the credential and
    whose deployment does not let its holder in — a private server, somebody
    its owner did not allow. Answered ``403`` with ``access_denied`` and no
    challenge: nothing was wrong with the token, and another one of the same
    caller would be refused the same way. Answering ``None`` instead says the
    credential is not valid, and sends a client to get a new one for nothing.
    """

    def __init__(self, description: str = "Not allowed here") -> None:
        super().__init__(description)
        self.description = description


def _forbidden(description: str) -> JSONResponse:
    return JSONResponse(
        {"error": "access_denied", "error_description": description},
        status_code=403,
        headers={"Cache-Control": "no-store"},
    )


def _refused_by_the_backend(conn: Any, error: AuthenticationError) -> Response:
    if isinstance(error, Forbidden):
        return _forbidden(error.description)
    return JSONResponse({"error": "invalid_request", "error_description": str(error)}, 400)


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

    The key comes from the issuer's JWKS (``jwks_uri``: the set is kept for
    ``jwks_cache_seconds``, five minutes unless said, and read again after
    that or when a token names a key it does not have, so a key the issuer
    removes stops being trusted) or is given (``key``, a PEM public key or a
    shared secret — name its ``algorithms`` then).

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
        jwks_cache_seconds: int = 300,
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
        # The key *set* is kept for `jwks_cache_seconds` and then read again;
        # no key is kept on its own beyond that. A key the issuer removes —
        # a compromised one — stops verifying tokens within that time, where
        # a per-key cache would trust it for as long as the process lives.
        self._jwks = (
            jwt.PyJWKClient(
                jwks_uri, cache_keys=False, cache_jwk_set=True, lifespan=jwks_cache_seconds
            )
            if jwks_uri
            else None
        )

    @classmethod
    def for_resource(cls, resource: ProtectedResource, **options: Any) -> "JWTVerifier":
        """A verifier of the tokens `resource`'s first authorization server
        issues for it.

        The audience is the resource's URL **exactly as configured** — the
        one its document publishes and a client sends as ``resource`` — a
        query included. A deployment whose tokens name another audience (one
        shared by several URLs) constructs the verifier with it.
        """
        return cls(
            issuer=resource.authorization_servers[0],
            audience=resource.resource,
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
                on_error=_refused_by_the_backend,
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


#: What a selection's tools require, read without building anything
#: (``McpHost.declared_scopes``): for the challenge of a caller nobody admitted.
DeclaredScopes = Callable[[Scope], Mapping[str, Sequence[str]]]

#: Where the guard leaves what it established, in the ASGI scope's ``state``,
#: for whoever dispatches the request to finish authorizing it.
AUTHORIZATION = "reactor.mcp.oauth.authorization"


@dataclass(frozen=True)
class Authorization:
    """What the guard established about a request, before it is dispatched.

    The caller, and the tools the request could be a call of. Which scopes
    those tools require is the business of the server the request is
    dispatched to, so the question is finished there, against that very
    server (:meth:`refusal`): asked of an earlier build, a tool that arrived
    in between would be called without what it requires.
    """

    resource: ProtectedResource
    #: The caller, or ``None`` for one admitted without being named.
    user: Optional[AuthenticatedUser]
    #: The tools the body could call (:func:`_tools_called`).
    called: frozenset[str]

    def refusal(
        self, required: Mapping[str, Sequence[str]]
    ) -> Optional[Callable[[Send], Awaitable[None]]]:
        """How to refuse the request given what the server serving it
        requires, or ``None`` when its caller holds what it needs."""
        needed = list(self.resource.required_scopes)
        for name in sorted(self.called):
            needed += [item for item in required.get(name, ()) if item not in needed]
        return _refusal(self.resource, self.user, needed)


def _refusal(
    resource: ProtectedResource, user: Optional[AuthenticatedUser], needed: Sequence[str]
) -> Optional[Callable[[Send], Awaitable[None]]]:
    if user is None:
        if not needed:
            return None
        # Nobody in particular, and the call needs a scope: somebody has to
        # hold it. The challenge names it.
        return lambda send: refuse(send, resource, scopes=needed)
    missing = [item for item in needed if item not in user.scopes]
    if not missing:
        return None
    return lambda send: refuse(
        send,
        resource,
        status=403,
        error=INSUFFICIENT_SCOPE,
        description=f"Required scope: {' '.join(missing)}",
        scopes=needed,
    )


def _presents_bearer(scope: Scope) -> bool:
    """Whether the request presents a bearer token, valid or not: the header
    the SDK's backend reads, read the same way."""
    for name, value in scope.get("headers") or []:
        if name.lower() == b"authorization":
            return value.decode("latin-1").lower().startswith("bearer ")
    return False


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
      ``insufficient_scope``, naming them;
    * a caller a verifier or an admission knows and does not let in
      (:class:`Forbidden`) — ``403``, ``access_denied``.

    The scopes needed are the resource's ``required_scopes`` and, for a
    ``tools/call``, those of the tool and its toolset — as the server the
    request is dispatched to requires them, which the router checks with what
    this leaves it (:class:`Authorization`).
    """

    def __init__(
        self,
        app: Any,
        oauth: OAuth,
        *,
        declared_scopes: Optional[DeclaredScopes] = None,
        max_body: int = MAX_PEEKED_BODY,
    ) -> None:
        self.app = app
        self.oauth = oauth
        #: Given for the application that serves tools (the router): the
        #: request's body is then read for the tools it could call, and what
        #: it established is left for the router (:data:`AUTHORIZATION`).
        self.declared_scopes = declared_scopes
        self.max_body = max_body

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        # Who is calling comes first, and everything else is asked about
        # *that* caller: the resource as the request sees it, the tenant, the
        # scopes a tool requires. Resolved before the caller is known, a
        # request admitted by a key would be checked against whatever an
        # anonymous caller reaches, and then served as somebody else.
        user = scope.get("user")
        anonymous = False
        admitted_as: Optional[AuthenticatedUser] = None
        if not isinstance(user, AuthenticatedUser):
            if _presents_bearer(scope):
                # A token was presented and is not valid here. Said before any
                # other way in is asked: an admission is for a request
                # *without* a bearer, and a bad token beside a good key is
                # still a bad token.
                await refuse(
                    send,
                    self.oauth.resource.at(scope),
                    error=INVALID_TOKEN,
                    description="The access token is expired, revoked or not valid here",
                )
                return
            try:
                admitted = await self.oauth.admitted(scope)
            except Forbidden as error:
                await _forbidden(error.description)(scope, receive, send)
                return
            if isinstance(admitted, AccessToken):
                # Another way in that says who came in: the caller from here
                # on, held to the scopes it was admitted with.
                user = admitted_as = AuthenticatedUser(admitted)
                scope["user"] = user
                scope["auth"] = AuthCredentials(admitted.scopes)
            else:
                user = None
                anonymous = bool(admitted)
        if admitted_as is None:
            await self._authorized(scope, receive, send, user, anonymous)
            return
        kept = auth_context_var.set(admitted_as)
        try:
            await self._authorized(scope, receive, send, user, anonymous)
        finally:
            auth_context_var.reset(kept)

    async def _authorized(
        self,
        scope: Scope,
        receive: Receive,
        send: Send,
        user: Optional[AuthenticatedUser],
        anonymous: bool,
    ) -> None:
        """Serve the request if its caller — known by now, and in the auth
        context — holds what it needs."""
        resource = self.oauth.resource.at(scope)
        admitted = user is not None or anonymous
        called: frozenset[str] = frozenset()
        if self.declared_scopes is not None and scope.get("method") == "POST":
            body, receive = await self._peeked(receive)
            if body is None:
                await _too_large(send)
                return
            called = frozenset(_tools_called(body))
        if not admitted:
            # Nobody admitted this caller: told what the call would need from
            # what is declared, and nothing is built or woken for them.
            needed = list(resource.required_scopes)
            if called and self.declared_scopes is not None:
                declared = self.declared_scopes(scope)
                for name in sorted(called):
                    needed += [item for item in declared.get(name, ()) if item not in needed]
            await refuse(send, resource, scopes=needed)
            return
        if self.declared_scopes is None:
            # Not the application that serves tools: the scopes every request
            # needs are the whole of it.
            refusal = _refusal(resource, user, resource.required_scopes)
            if refusal is not None:
                await refusal(send)
                return
        else:
            # The tools' scopes belong to the server the request is dispatched
            # to: the router finishes, against the server it serves it with.
            scope.setdefault("state", {})[AUTHORIZATION] = Authorization(
                resource=resource, user=user, called=called
            )
        await self.app(scope, receive, send)

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


class _Members(list):  # type: ignore[type-arg]
    """A JSON object as its members in order, a repeated name kept each time."""

    def all(self, name: str) -> list[Any]:
        return [value for key, value in self if key == name]


def _tools_called(body: bytes) -> set[str]:
    """Every tool a request body could be a ``tools/call`` of.

    Read to *require* scopes, so read generously: what this finds too many of
    costs a refusal, and what it missed would be a call nobody checked. A
    member written twice is taken each time (two parsers may not agree on
    which one counts), and a batch is every message in it. A body no JSON
    parser reads calls nothing: the server refuses it too.
    """
    try:
        message = json.loads(body, object_pairs_hook=_Members)
    except ValueError:
        try:
            import pydantic_core  # noqa: PLC0415 - the parser the SDK reads a body with

            message = pydantic_core.from_json(body)
        except ValueError:
            return set()
    found: set[str] = set()
    for item in message if isinstance(message, list) and not isinstance(message, _Members) else [message]:
        methods = item.all("method") if isinstance(item, _Members) else (
            [item.get("method")] if isinstance(item, dict) else []
        )
        if "tools/call" not in methods:
            continue
        several = item.all("params") if isinstance(item, _Members) else [item.get("params")]
        for params in several:
            names = params.all("name") if isinstance(params, _Members) else (
                [params.get("name")] if isinstance(params, dict) else []
            )
            found.update(name for name in names if isinstance(name, str))
    return found


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
    "AUTHORIZATION",
    "AccessToken",
    "Admission",
    "Admitted",
    "Authorization",
    "ChallengeMiddleware",
    "Forbidden",
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
