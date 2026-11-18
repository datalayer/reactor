# Copyright (c) 2026-Present Datalayer, Inc.
#
# BSD 3-Clause License

"""OAuth, contributed: the document, the challenge, the verifier, the scopes.

The parts first — what a protected resource says of itself, what a challenge
reads like, what a JWT verifier accepts — then the thing: an application served
with OAuth, asked over HTTP the way a client asks, and a real MCP client
through it whose tool handler reads who is calling.

Launch the tests:
```
$ pytest tests/test_oauth.py -v
```
"""

from __future__ import annotations

import json
import socket
import threading
import time
from contextlib import asynccontextmanager, closing
from dataclasses import replace
from urllib.parse import parse_qs

import jwt
import pytest
import uvicorn
from cryptography.hazmat.primitives.asymmetric import rsa
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from mcp.server.auth.provider import AccessToken
from mcp.shared._httpx_utils import create_mcp_http_client
from reactor import PluginManifest
from starlette.testclient import TestClient

from reactor_mcp_server import (
    JWTVerifier,
    McpExtension,
    OAuthExtension,
    ProtectedResource,
    ToolExtension,
    ToolSpec,
    Toolset,
    build_host,
    create_mcp_app,
    current_access_token,
    tool,
)
from reactor_mcp_server.__main__ import oauth_extension, parser
from reactor_mcp_server.oauth import (
    ChallengeMiddleware,
    Forbidden,
    _tools_called,
    anyone,
    challenge,
    with_challenge,
)

RESOURCE = ProtectedResource(
    resource="https://mcp.example.com/mcp",
    authorization_servers=("https://auth.example.com",),
    scopes_supported=("notes:read", "notes:write"),
)
DOCUMENT_URL = "https://mcp.example.com/.well-known/oauth-protected-resource/mcp"


def token(subject: str, *scopes: str) -> str:
    return f"{subject}|{' '.join(scopes)}"


async def verifier(presented: str) -> AccessToken | None:
    """A verifier for these tests: `subject|scope scope`, anything else unknown."""
    subject, bar, scopes = presented.partition("|")
    if not bar or not subject:
        return None
    return AccessToken(
        token=presented, client_id="tests", scopes=scopes.split(), subject=subject
    )


class Notes(McpExtension):
    def manifest(self) -> PluginManifest:
        return PluginManifest(name="notes", version="1.0.0")

    def toolsets(self):
        return (Toolset(name="notes", scopes=("notes:read",)),)

    @tool()
    async def list_notes(self) -> list[str]:
        """Every note of the caller."""
        return ["one", "two"]

    @tool(scopes=("notes:write",))
    async def write_note(self, text: str) -> str:
        """Write a note."""
        return text

    @tool()
    async def who_am_i(self) -> dict:
        """Who the handler sees calling."""
        caller = current_access_token()
        return {
            "subject": caller.subject if caller else None,
            "scopes": list(caller.scopes) if caller else [],
        }


class Clock(McpExtension):
    """A toolset that requires nothing."""

    def manifest(self) -> PluginManifest:
        return PluginManifest(name="clock", version="1.0.0")

    @tool()
    async def now(self) -> str:
        """The time."""
        return "noon"


def app_with(*extensions, resource: ProtectedResource = RESOURCE, **options):
    host = build_host([*extensions, OAuthExtension(resource, verifier=verifier)], name="tests")
    return create_mcp_app(host, path="/mcp", **options)


def call(name: str, **arguments) -> dict:
    return {
        "jsonrpc": "2.0",
        "id": 1,
        "method": "tools/call",
        "params": {"name": name, "arguments": arguments},
    }


def bearer(value: str) -> dict:
    return {"Authorization": f"Bearer {value}"}


# --- The resource -----------------------------------------------------------


class TestTheProtectedResource:
    def test_its_document_is_rfc_9728s(self) -> None:
        assert RESOURCE.document() == {
            "resource": "https://mcp.example.com/mcp",
            "authorization_servers": ["https://auth.example.com"],
            "scopes_supported": ["notes:read", "notes:write"],
            "bearer_methods_supported": ["header"],
        }

    def test_the_document_is_where_rfc_9728_puts_it_for_the_path(self) -> None:
        assert RESOURCE.well_known_url == DOCUMENT_URL
        assert RESOURCE.paths() == (
            "/.well-known/oauth-protected-resource",
            "/.well-known/oauth-protected-resource/mcp",
        )

    def test_a_resource_without_a_path_has_one_address(self) -> None:
        bare = replace(RESOURCE, resource="https://mcp.example.com")
        assert bare.paths() == ("/.well-known/oauth-protected-resource",)
        assert bare.well_known_url == (
            "https://mcp.example.com/.well-known/oauth-protected-resource"
        )

    def test_a_path_ending_in_a_slash_is_served_where_clients_look_and_as_written(self) -> None:
        slashed = replace(RESOURCE, resource="https://mcp.example.com/mcp/")
        assert slashed.well_known_url == DOCUMENT_URL
        assert slashed.paths() == (
            "/.well-known/oauth-protected-resource",
            "/.well-known/oauth-protected-resource/mcp",
            "/.well-known/oauth-protected-resource/mcp/",
        )

    @pytest.mark.parametrize(
        "url",
        ["https://MCP.example.com/mcp", "https://mcp.example.com:443/mcp", "https://mcp.example.com/a b"],
    )
    def test_it_is_written_as_it_is_published(self, url: str) -> None:
        """A URL the document would publish differently is one a verifier and
        a client would not agree on, character for character."""
        with pytest.raises(ValueError, match="written as published"):
            replace(RESOURCE, resource=url)

    def test_and_so_are_its_authorization_servers(self) -> None:
        with pytest.raises(ValueError, match="written as published"):
            replace(RESOURCE, authorization_servers=("https://AUTH.example.com",))

    def test_more_members_are_merged_in(self) -> None:
        document = replace(
            RESOURCE,
            resource_name="Notes",
            resource_documentation="https://example.com/docs",
            extra={"resource_policy_uri": "https://example.com/policy"},
        ).document()
        assert document["resource_name"] == "Notes"
        assert document["resource_documentation"] == "https://example.com/docs"
        assert document["resource_policy_uri"] == "https://example.com/policy"

    @pytest.mark.parametrize("url", ["mcp.example.com/mcp", "ftp://x/mcp", "https://x/mcp#a"])
    def test_it_is_an_http_url_without_a_fragment(self, url: str) -> None:
        with pytest.raises(ValueError):
            ProtectedResource(resource=url, authorization_servers=("https://auth.example.com",))

    def test_it_names_an_authorization_server(self) -> None:
        with pytest.raises(ValueError):
            ProtectedResource(resource="https://x.example/mcp", authorization_servers=())


class TestTheChallenge:
    def test_without_a_token_it_names_the_document_and_no_error(self) -> None:
        assert challenge(RESOURCE) == f'Bearer resource_metadata="{DOCUMENT_URL}"'

    def test_the_realm_comes_first(self) -> None:
        assert challenge(replace(RESOURCE, realm="Example")) == (
            f'Bearer realm="Example", resource_metadata="{DOCUMENT_URL}"'
        )

    def test_it_names_the_scopes_needed_once_each(self) -> None:
        assert challenge(
            RESOURCE,
            error="insufficient_scope",
            description="Required scope: notes:write",
            scopes=("notes:read", "notes:write", "notes:read"),
        ) == (
            'Bearer error="insufficient_scope", '
            'error_description="Required scope: notes:write", '
            f'scope="notes:read notes:write", resource_metadata="{DOCUMENT_URL}"'
        )

    def test_a_challenge_that_names_no_document_gains_it(self) -> None:
        headers = with_challenge([(b"www-authenticate", b'Bearer error="invalid_token"')], RESOURCE)
        assert headers == [
            (
                b"www-authenticate",
                f'Bearer error="invalid_token", resource_metadata="{DOCUMENT_URL}"'.encode(),
            )
        ]

    def test_one_that_names_it_is_kept(self) -> None:
        kept = [(b"WWW-Authenticate", b'Bearer resource_metadata="https://elsewhere"')]
        assert with_challenge(kept, RESOURCE) == kept

    def test_a_401_without_any_gains_one(self) -> None:
        assert with_challenge([(b"content-type", b"text/plain")], RESOURCE)[-1] == (
            b"www-authenticate",
            challenge(RESOURCE).encode(),
        )

    def test_the_middleware_keeps_it_on_a_401_of_any_application(self) -> None:
        async def inner(scope, receive, send):
            status = 401 if scope["path"] == "/refused" else 200
            await send({"type": "http.response.start", "status": status, "headers": []})
            await send({"type": "http.response.body", "body": b""})

        client = TestClient(ChallengeMiddleware(inner, RESOURCE))
        assert client.get("/refused").headers["www-authenticate"] == challenge(RESOURCE)
        assert "www-authenticate" not in client.get("/served").headers


# --- What a host is given ---------------------------------------------------


class TestWhatAHostIsGiven:
    def test_no_oauth_unless_contributed(self) -> None:
        assert build_host([Clock()]).oauth() is None

    def test_a_resource_nothing_verifies_is_refused(self) -> None:
        host = build_host([OAuthExtension(RESOURCE)])
        with pytest.raises(ValueError, match="nothing verifies"):
            host.oauth()

    def test_a_verifier_without_a_resource_is_refused(self) -> None:
        host = build_host([OAuthExtension(verifier=verifier)])
        with pytest.raises(ValueError, match="exactly one protected resource"):
            create_mcp_app(host)

    def test_two_resources_are_refused(self) -> None:
        host = build_host(
            [
                OAuthExtension(RESOURCE, verifier=verifier),
                OAuthExtension(RESOURCE, name="another"),
            ]
        )
        with pytest.raises(ValueError, match="exactly one protected resource"):
            host.oauth()

    async def test_verifiers_are_asked_in_order_and_the_first_that_knows_answers(self) -> None:
        asked: list[str] = []

        class Keys:
            async def verify_token(self, presented: str) -> AccessToken | None:
                asked.append("keys")
                if presented != "a-key":
                    return None
                return AccessToken(token=presented, client_id="key", scopes=[], subject="owner")

        async def tokens(presented: str) -> AccessToken | None:
            asked.append("tokens")
            return await verifier(presented)

        host = build_host(
            [OAuthExtension(RESOURCE, verifier=Keys()), OAuthExtension(verifier=tokens, name="more")]
        )
        oauth = host.oauth()

        assert (await oauth.verifier.verify_token("a-key")).subject == "owner"
        assert asked == ["keys"]
        assert (await oauth.verifier.verify_token(token("ada"))).subject == "ada"
        assert (await oauth.verifier.verify_token("nobody knows")) is None

    def test_something_that_verifies_nothing_is_refused(self) -> None:
        host = build_host([OAuthExtension(RESOURCE, verifier="not a verifier")])
        with pytest.raises(ValueError, match="verifies no token"):
            host.oauth()

    def test_a_tool_requires_its_toolsets_scopes_and_its_own(self) -> None:
        host = build_host([Notes(), Clock()])
        assert host.required_scopes() == {
            "list_notes": ("notes:read",),
            "who_am_i": ("notes:read",),
            "write_note": ("notes:read", "notes:write"),
        }

    def test_an_extension_of_a_tool_requires_more_never_less(self) -> None:
        class Stricter(McpExtension):
            def manifest(self) -> PluginManifest:
                return PluginManifest(name="stricter", version="1.0.0")

            def toolsets(self):
                return ()

            def tool_extensions(self):
                return (("now", ToolExtension(scopes=("clock:read",))),)

        host = build_host([Clock(), Stricter()])
        assert host.required_scopes() == {"now": ("clock:read",)}


# --- Served -----------------------------------------------------------------


class TestServedAsAProtectedResource:
    @pytest.fixture()
    def client(self):
        with TestClient(app_with(Notes(), Clock())) as client:
            yield client

    @pytest.mark.parametrize("path", RESOURCE.paths())
    def test_the_document_is_served_to_anybody_at_both_paths(self, client, path) -> None:
        answer = client.get(path, headers={"Origin": "https://a-client.example"})
        assert answer.status_code == 200
        assert answer.json() == RESOURCE.document()
        # A client in a browser reads it too.
        assert answer.headers["access-control-allow-origin"] == "*"

    def test_health_stays_open(self, client) -> None:
        assert client.get("/healthz").status_code == 200

    def test_without_a_token_the_challenge_names_the_document(self, client) -> None:
        answer = client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"})
        assert answer.status_code == 401
        assert answer.headers["www-authenticate"] == challenge(RESOURCE)
        assert answer.json() == {
            "error": "invalid_token",
            "error_description": "Authentication required",
        }

    def test_a_get_is_challenged_too(self, client) -> None:
        assert client.get("/mcp").status_code == 401

    def test_without_a_token_a_tool_call_is_told_the_scopes_it_needs(self, client) -> None:
        answer = client.post("/mcp", json=call("write_note", text="hello"))
        assert answer.status_code == 401
        assert answer.headers["www-authenticate"] == challenge(
            RESOURCE, scopes=("notes:read", "notes:write")
        )

    def test_a_token_nobody_knows_is_invalid(self, client) -> None:
        answer = client.post("/mcp", json=call("now"), headers=bearer("nobody knows"))
        assert answer.status_code == 401
        assert 'error="invalid_token"' in answer.headers["www-authenticate"]
        assert f'resource_metadata="{DOCUMENT_URL}"' in answer.headers["www-authenticate"]

    def test_a_token_without_the_scope_is_insufficient(self, client) -> None:
        answer = client.post(
            "/mcp", json=call("write_note", text="hello"), headers=bearer(token("ada", "notes:read"))
        )
        assert answer.status_code == 403
        assert answer.headers["www-authenticate"] == challenge(
            RESOURCE,
            error="insufficient_scope",
            description="Required scope: notes:write",
            scopes=("notes:read", "notes:write"),
        )
        assert answer.json()["error"] == "insufficient_scope"

    def test_the_toolsets_scope_is_required_of_each_of_its_tools(self, client) -> None:
        answer = client.post("/mcp", json=call("list_notes"), headers=bearer(token("ada")))
        assert answer.status_code == 403
        assert 'scope="notes:read"' in answer.headers["www-authenticate"]

    def test_a_tool_that_requires_nothing_needs_only_a_token(self, client) -> None:
        answer = client.post(
            "/mcp",
            json=call("now"),
            headers={**bearer(token("ada")), "Accept": "application/json, text/event-stream"},
        )
        # Past this module: whatever the protocol then says, it is not a refusal.
        assert answer.status_code not in (401, 403)

    def test_what_is_listed_needs_a_token_too(self, client) -> None:
        assert client.get("/toolsets").status_code == 401
        listed = client.get("/toolsets", headers=bearer(token("ada")))
        assert listed.status_code == 200
        assert "write_note" in listed.json()["tools"]

    def test_unless_the_deployment_says_it_is_public(self) -> None:
        with TestClient(app_with(Notes(), public_toolsets=True)) as client:
            assert client.get("/toolsets").status_code == 200

    def test_the_scopes_every_request_needs(self) -> None:
        resource = replace(RESOURCE, required_scopes=("mcp:use",))
        with TestClient(app_with(Clock(), resource=resource)) as client:
            refused = client.get("/mcp")
            assert refused.status_code == 401
            assert 'scope="mcp:use"' in refused.headers["www-authenticate"]
            assert client.get("/mcp", headers=bearer(token("ada"))).status_code == 403

    def test_a_request_too_large_to_read_is_refused(self) -> None:
        from starlette.applications import Starlette
        from starlette.routing import Mount

        from reactor_mcp_server.oauth import RequireBearer

        host = build_host([Notes(), OAuthExtension(RESOURCE, verifier=verifier)])
        oauth = host.oauth()
        guard = RequireBearer(
            create_mcp_app(host), oauth, tool_scopes=lambda scope: host.required_scopes(), max_body=64
        )
        app = Starlette(routes=[Mount("", app=guard)], middleware=oauth.middleware())
        answer = TestClient(app).post(
            "/mcp", json=call("write_note", text="x" * 200), headers=bearer(token("ada"))
        )
        assert answer.status_code == 413

    def test_the_document_follows_the_request_when_the_deployment_says_how(self) -> None:
        def narrowed(resource: ProtectedResource, scope) -> ProtectedResource:
            named = parse_qs(scope.get("query_string", b"").decode()).get("scopes")
            if not named:
                return resource
            return replace(
                resource,
                resource=f"{resource.resource}?scopes={named[0]}",
                scopes_supported=tuple(named[0].split(",")),
                metadata_url=f"{DOCUMENT_URL}?scopes={named[0]}",
            )

        resource = replace(RESOURCE, for_request=narrowed)
        with TestClient(app_with(Clock(), resource=resource)) as client:
            document = client.get(f"{RESOURCE.paths()[1]}?scopes=notes:read")
            assert document.json()["resource"] == "https://mcp.example.com/mcp?scopes=notes:read"
            assert document.json()["scopes_supported"] == ["notes:read"]
            assert "cache-control" not in document.headers
            refused = client.get("/mcp?scopes=notes:read")
            assert refused.headers["www-authenticate"] == (
                f'Bearer resource_metadata="{DOCUMENT_URL}?scopes=notes:read"'
            )


class TestAnotherWayIn:
    def test_a_server_open_to_anybody_serves_a_caller_without_a_token(self) -> None:
        host = build_host([Notes(), Clock(), OAuthExtension(RESOURCE, verifier=verifier, admits=anyone)])
        with TestClient(create_mcp_app(host)) as client:
            headers = {"Accept": "application/json, text/event-stream"}
            assert client.post("/mcp", json=call("now"), headers=headers).status_code not in (401, 403)
            # What needs a scope still needs somebody to hold it.
            refused = client.post("/mcp", json=call("list_notes"), headers=headers)
            assert refused.status_code == 401
            assert 'scope="notes:read"' in refused.headers["www-authenticate"]
            # And a token that is wrong is said to be, open or not.
            assert client.post("/mcp", json=call("now"), headers=bearer("nope")).status_code == 401

    def test_a_key_of_the_deployments_own_names_the_caller(self) -> None:
        async def by_key(scope) -> AccessToken | None:
            headers = dict(scope["headers"])
            if headers.get(b"x-api-key") != b"the-key":
                return None
            return AccessToken(
                token="the-key", client_id="key", scopes=["notes:read"], subject="owner"
            )

        host = build_host([Notes(), OAuthExtension(RESOURCE, verifier=verifier, admits=by_key)])
        with TestClient(create_mcp_app(host)) as client:
            assert client.get("/toolsets").status_code == 401
            assert client.get("/toolsets", headers={"X-API-Key": "wrong"}).status_code == 401
            assert client.get("/toolsets", headers={"X-API-Key": "the-key"}).status_code == 200
            # Held to the scopes it was admitted with.
            refused = client.post(
                "/mcp", json=call("write_note", text="hello"), headers={"X-API-Key": "the-key"}
            )
            assert refused.status_code == 403


class TestKnownAndNotAllowed:
    """A private server: its verifier knows whose the token is, and the
    deployment does not let everybody it knows in."""

    def test_a_verifier_that_refuses_a_caller_it_knows_answers_403(self) -> None:
        async def only_ada(presented: str) -> AccessToken | None:
            found = await verifier(presented)
            if found is not None and found.subject != "ada":
                raise Forbidden("Its owner has not allowed you to call it")
            return found

        host = build_host([Clock(), OAuthExtension(RESOURCE, verifier=only_ada)])
        with TestClient(create_mcp_app(host)) as client:
            refused = client.get("/toolsets", headers=bearer(token("grace")))
            assert refused.status_code == 403
            assert refused.json() == {
                "error": "access_denied",
                "error_description": "Its owner has not allowed you to call it",
            }
            # Not a challenge: another token of the same caller would not help.
            assert "www-authenticate" not in refused.headers
            assert client.get("/toolsets", headers=bearer(token("ada"))).status_code == 200
            # Unknown is still unknown.
            assert client.get("/toolsets", headers=bearer("nobody")).status_code == 401

    def test_an_admission_refuses_the_same_way(self) -> None:
        async def by_key(scope) -> AccessToken | None:
            key = dict(scope["headers"]).get(b"x-api-key")
            if key is None:
                return None
            if key != b"the-owners":
                raise Forbidden()
            return AccessToken(token="k", client_id="key", scopes=[], subject="owner")

        host = build_host([Clock(), OAuthExtension(RESOURCE, verifier=verifier, admits=by_key)])
        with TestClient(create_mcp_app(host)) as client:
            refused = client.get("/toolsets", headers={"X-API-Key": "somebody-elses"})
            assert (refused.status_code, refused.json()["error"]) == (403, "access_denied")
            assert client.get("/toolsets", headers={"X-API-Key": "the-owners"}).status_code == 200


class TestTheCallerComesFirst:
    """Authentication before authorization: what a request needs is asked
    about the caller it turned out to be."""

    def test_what_a_key_is_admitted_to_is_checked_in_the_tenant_it_is_admitted_as(self) -> None:
        """A tenant read from the caller, and a key admitted without the
        scope: resolved before the caller was known, the request was checked
        against the tenant nobody is (where the tool is not served) and then
        ran the scoped tool in the key's own."""
        async def by_key(scope) -> AccessToken | None:
            if dict(scope["headers"]).get(b"x-api-key") != b"acme-key":
                return None
            return AccessToken(token="k", client_id="key", scopes=[], subject="acme")

        def tenant(scope) -> str | None:
            user = scope.get("user")
            return getattr(getattr(user, "access_token", None), "subject", None) or "nobody"

        class AcmesNotes(Notes):
            """The notes, served to one tenant."""

            def manifest(self) -> PluginManifest:
                return PluginManifest(name="notes", version="1.0.0", tenant_scopes=["acme"])

        host = build_host(
            [AcmesNotes(), Clock(), OAuthExtension(RESOURCE, verifier=verifier, admits=by_key)]
        )
        assert "write_note" not in host.required_scopes(tenant_id="nobody")
        assert "write_note" in host.required_scopes(tenant_id="acme")
        with TestClient(create_mcp_app(host, tenant_resolver=tenant)) as client:
            refused = client.post(
                "/mcp",
                json=call("write_note", text="hello"),
                headers={"X-API-Key": "acme-key", "Accept": "application/json, text/event-stream"},
            )
        assert refused.status_code == 403
        assert 'error="insufficient_scope"' in refused.headers["www-authenticate"]

    def test_a_bad_token_beside_a_good_key_is_a_bad_token(self) -> None:
        async def by_key(scope) -> AccessToken | None:
            if dict(scope["headers"]).get(b"x-api-key") != b"the-key":
                return None
            return AccessToken(token="k", client_id="key", scopes=["notes:read"], subject="owner")

        host = build_host([Notes(), OAuthExtension(RESOURCE, verifier=verifier, admits=by_key)])
        with TestClient(create_mcp_app(host)) as client:
            both = client.get(
                "/toolsets", headers={"X-API-Key": "the-key", **bearer("expired or invented")}
            )
            assert both.status_code == 401
            assert 'error="invalid_token"' in both.headers["www-authenticate"]
            # The key alone is admitted, and a good token beside it is the caller.
            assert client.get("/toolsets", headers={"X-API-Key": "the-key"}).status_code == 200
            assert (
                client.get(
                    "/toolsets", headers={"X-API-Key": "the-key", **bearer(token("ada"))}
                ).status_code
                == 200
            )

    def test_an_open_server_does_not_take_a_bad_token_for_nobody(self) -> None:
        host = build_host([Clock(), OAuthExtension(RESOURCE, verifier=verifier, admits=anyone)])
        with TestClient(create_mcp_app(host)) as client:
            assert client.get("/toolsets").status_code == 200
            assert client.get("/toolsets", headers=bearer("nope")).status_code == 401


class TestTheToolThatIsServedIsTheOneGuarded:
    """Two tools of one name: the SDK serves the first registered, so the
    first one's scopes — none included — are the call's."""

    @staticmethod
    def offering(name: str, order: int, scopes: tuple[str, ...]) -> McpExtension:
        class Offering(McpExtension):
            def manifest(self) -> PluginManifest:
                return PluginManifest(name=name, version="1.0.0")

            def toolsets(self):
                return (Toolset(name="notes"),)

            def tools(self):
                async def save(text: str) -> str:
                    return f"{name} saved {text}"

                return [ToolSpec(name="save", handler=save, scopes=scopes)]

        return Offering()

    def test_the_first_requires_more_than_the_second(self) -> None:
        host = build_host(
            [self.offering("writer", 0, ("notes:write",)), self.offering("reader", 1, ("notes:read",))]
        )
        assert [spec.scopes for spec in host.build().tools if spec.name == "save"][0] == ("notes:write",)
        assert host.required_scopes() == {"save": ("notes:write",)}

    def test_the_first_requires_less_than_the_second(self) -> None:
        host = build_host(
            [self.offering("reader", 0, ("notes:read",)), self.offering("writer", 1, ("notes:write",))]
        )
        assert host.required_scopes() == {"save": ("notes:read",)}

    def test_the_first_requires_nothing(self) -> None:
        host = build_host([self.offering("open", 0, ()), self.offering("writer", 1, ("notes:write",))])
        assert host.required_scopes() == {}

    async def test_and_it_is_the_first_that_runs(self) -> None:
        host = build_host(
            [self.offering("writer", 0, ("notes:write",)), self.offering("reader", 1, ("notes:read",))]
        )
        answer = await host.build().server.call_tool("save", {"text": "x"})
        assert "writer saved x" in str(answer)

    def test_a_toolset_two_extensions_declare_requires_what_either_says(self) -> None:
        class Lifecycle(McpExtension):
            def manifest(self) -> PluginManifest:
                return PluginManifest(name="lifecycle", version="1.0.0")

            def toolsets(self):
                return (Toolset(name="sandboxes"),)

            @tool()
            async def run(self) -> str:
                return "ran"

        class Deployment(McpExtension):
            def manifest(self) -> PluginManifest:
                return PluginManifest(name="deployment", version="1.0.0")

            def toolsets(self):
                return (Toolset(name="sandboxes", scopes=("sandboxes:manage",)),)

            @tool()
            async def launch(self) -> str:
                return "launched"

        host = build_host([Lifecycle(), Deployment()])
        assert host.required_scopes() == {
            "launch": ("sandboxes:manage",),
            "run": ("sandboxes:manage",),
        }


class TestWhatABodyCouldBeACallOf:
    """Read to require scopes, so read generously."""

    def test_a_call(self) -> None:
        assert _tools_called(json.dumps(call("write_note", text="x")).encode()) == {"write_note"}

    def test_anything_else_calls_nothing(self) -> None:
        assert _tools_called(b'{"jsonrpc": "2.0", "id": 1, "method": "tools/list"}') == set()
        assert _tools_called(b"not json") == set()
        assert _tools_called(b"[1, 2]") == set()

    def test_a_member_written_twice_is_taken_each_time(self) -> None:
        twice = b'{"method": "tools/call", "params": {"name": "now", "name": "write_note"}, "method": "ping"}'
        assert _tools_called(twice) == {"now", "write_note"}
        params = b'{"method": "tools/call", "params": {"name": "write_note"}, "params": {"name": "now"}}'
        assert _tools_called(params) == {"now", "write_note"}

    def test_a_batch_is_every_message_in_it(self) -> None:
        batch = json.dumps([call("now"), call("write_note", text="x")]).encode()
        assert _tools_called(batch) == {"now", "write_note"}

    def test_a_scoped_tool_hidden_behind_a_repeated_name_is_still_guarded(self) -> None:
        body = b'{"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "now", "name": "write_note", "arguments": {"text": "x"}}}'
        with TestClient(app_with(Notes(), Clock())) as client:
            answer = client.post(
                "/mcp",
                content=body,
                headers={**bearer(token("ada")), "Content-Type": "application/json"},
            )
        assert answer.status_code == 403


class TestCalledFromABrowser:
    ORIGIN = "https://app.example.com"

    @pytest.fixture()
    def client(self):
        app = app_with(Notes(), cors={"allow_origins": [self.ORIGIN]})
        with TestClient(app) as client:
            yield client

    def test_a_preflight_is_answered_not_challenged(self, client) -> None:
        answer = client.options(
            "/mcp",
            headers={
                "Origin": self.ORIGIN,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "authorization, content-type",
            },
        )
        assert answer.status_code == 200
        assert answer.headers["access-control-allow-origin"] == self.ORIGIN
        assert "authorization" in answer.headers["access-control-allow-headers"].lower()

    def test_a_refusal_reaches_the_page_with_its_challenge(self, client) -> None:
        answer = client.post("/mcp", json=call("list_notes"), headers={"Origin": self.ORIGIN})
        assert answer.status_code == 401
        assert answer.headers["access-control-allow-origin"] == self.ORIGIN
        assert "WWW-Authenticate" in answer.headers["access-control-expose-headers"]
        assert "resource_metadata=" in answer.headers["www-authenticate"]

    def test_without_it_a_preflight_meets_the_guard(self) -> None:
        with TestClient(app_with(Notes())) as client:
            answer = client.options(
                "/mcp", headers={"Origin": self.ORIGIN, "Access-Control-Request-Method": "POST"}
            )
        assert answer.status_code == 401
        assert "access-control-allow-origin" not in answer.headers


# --- A real client ----------------------------------------------------------


def a_free_port() -> int:
    with closing(socket.socket()) as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


@pytest.fixture(scope="module")
def served() -> str:
    app = app_with(Notes(), Clock())
    port = a_free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    for _ in range(200):
        if server.started:
            break
        threading.Event().wait(0.05)
    assert server.started, "the test server did not start"
    try:
        yield f"http://127.0.0.1:{port}"
    finally:
        server.should_exit = True
        thread.join(timeout=10)


@asynccontextmanager
async def connected(url: str, presented: str):
    async with create_mcp_http_client(headers=bearer(presented)) as http:
        async with streamable_http_client(url, http_client=http) as (read, write, *_):
            async with ClientSession(read, write) as session:
                await session.initialize()
                yield session


class TestARealClientWithAToken:
    async def test_it_lists_and_calls_and_the_handler_knows_who_calls(self, served) -> None:
        async with connected(f"{served}/mcp", token("ada", "notes:read")) as session:
            names = {item.name for item in (await session.list_tools()).tools}
            answer = await session.call_tool("who_am_i", {})

        assert names == {"list_notes", "write_note", "who_am_i", "now"}
        assert json.loads(answer.content[0].text) == {"subject": "ada", "scopes": ["notes:read"]}

    async def test_two_callers_are_two_callers(self, served) -> None:
        async with connected(f"{served}/mcp", token("ada", "notes:read")) as ada:
            async with connected(f"{served}/mcp", token("grace", "notes:read")) as grace:
                first = await ada.call_tool("who_am_i", {})
                second = await grace.call_tool("who_am_i", {})
                again = await ada.call_tool("who_am_i", {})

        assert json.loads(first.content[0].text)["subject"] == "ada"
        assert json.loads(second.content[0].text)["subject"] == "grace"
        assert json.loads(again.content[0].text)["subject"] == "ada"


# --- The ready verifier -----------------------------------------------------


ISSUER = "https://auth.example.com"
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)


def signed(key=KEY, **claims) -> str:
    payload = {
        "iss": ISSUER,
        "aud": RESOURCE.resource,
        "sub": "ada",
        "exp": int(time.time()) + 600,
        "scope": "notes:read notes:write",
        "client_id": "an-agent",
        **claims,
    }
    return jwt.encode(
        {name: value for name, value in payload.items() if value is not None},
        key,
        algorithm="RS256",
        headers={"kid": "k1"},
    )


class TestTheJWTVerifier:
    @pytest.fixture()
    def verify(self):
        return JWTVerifier.for_resource(RESOURCE, key=KEY.public_key()).verify_token

    async def test_a_token_of_the_issuer_for_this_resource_is_the_caller(self, verify) -> None:
        found = await verify(signed())
        assert found.subject == "ada"
        assert found.client_id == "an-agent"
        assert found.scopes == ["notes:read", "notes:write"]
        assert found.resource == RESOURCE.resource
        assert found.claims["iss"] == ISSUER

    async def test_scopes_as_a_list_are_read_too(self, verify) -> None:
        assert (await verify(signed(scope=["notes:read"]))).scopes == ["notes:read"]

    async def test_one_of_several_audiences_is_enough(self, verify) -> None:
        found = await verify(signed(aud=["https://api.example.com", RESOURCE.resource]))
        assert found.resource == RESOURCE.resource

    @pytest.mark.parametrize(
        "claims",
        [
            {"aud": "https://other.example.com/mcp"},
            {"aud": None},
            {"iss": "https://evil.example.com"},
            {"exp": int(time.time()) - 600},
            {"exp": None},
            {"cnf": {"jkt": "a-thumbprint"}},
        ],
        ids=["another-audience", "no-audience", "another-issuer", "expired", "no-expiry", "key-bound"],
    )
    async def test_anything_else_is_refused(self, verify, claims) -> None:
        assert await verify(signed(**claims)) is None

    async def test_a_token_another_key_signed_is_refused(self, verify) -> None:
        other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        assert await verify(signed(key=other)) is None
        assert await verify("not a token") is None

    async def test_the_key_is_read_from_the_issuers_jwks(self, monkeypatch) -> None:
        jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(KEY.public_key()))
        fetched: list[str] = []

        def fetch_data(self):
            fetched.append(self.uri)
            return {"keys": [{**jwk, "kid": "k1", "use": "sig", "alg": "RS256"}]}

        monkeypatch.setattr(jwt.PyJWKClient, "fetch_data", fetch_data)
        verify = JWTVerifier.for_resource(RESOURCE, jwks_uri=f"{ISSUER}/jwks").verify_token

        assert (await verify(signed())).subject == "ada"
        assert (await verify(signed(sub="grace"))).subject == "grace"
        assert fetched == [f"{ISSUER}/jwks"]

    async def test_the_audience_is_the_resource_exactly_as_configured(self) -> None:
        """A resource whose URL carries a query is another audience than the
        one without it: the document publishes the whole URL, and a token for
        the bare one is not a token for this resource."""
        tenant = replace(RESOURCE, resource="https://mcp.example.com/mcp?tenant=acme")
        assert tenant.document()["resource"] == "https://mcp.example.com/mcp?tenant=acme"
        verify = JWTVerifier.for_resource(tenant, key=KEY.public_key()).verify_token

        assert await verify(signed()) is None
        assert await verify(signed(aud="https://mcp.example.com/mcp?tenant=other")) is None
        found = await verify(signed(aud="https://mcp.example.com/mcp?tenant=acme"))
        assert found.resource == "https://mcp.example.com/mcp?tenant=acme"

    def test_it_needs_one_source_of_keys(self) -> None:
        with pytest.raises(ValueError):
            JWTVerifier(issuer=ISSUER, audience=RESOURCE.resource)
        with pytest.raises(ValueError):
            JWTVerifier(issuer=ISSUER, audience=RESOURCE.resource, jwks_uri="https://x", key="k")


class TestTheCommandLine:
    def test_no_oauth_unless_asked(self) -> None:
        assert oauth_extension(parser().parse_args([])) == []

    def test_half_of_it_is_refused(self) -> None:
        with pytest.raises(SystemExit):
            oauth_extension(parser().parse_args(["--oauth-resource", RESOURCE.resource]))

    def test_the_three_together_make_the_host_a_protected_resource(self) -> None:
        arguments = parser().parse_args(
            [
                "--oauth-resource", RESOURCE.resource,
                "--oauth-issuer", ISSUER,
                "--oauth-jwks-uri", f"{ISSUER}/jwks",
                "--oauth-scopes", "notes:read,notes:write",
            ]
        )
        oauth = build_host(oauth_extension(arguments)).oauth()
        assert oauth.resource.document() == RESOURCE.document()
