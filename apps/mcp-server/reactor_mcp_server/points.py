# Copyright (c) 2026-Present Datalayer, Inc.
#
# BSD 3-Clause License

"""The contribution points an MCP server reads, and the events that fill them.

Seven points and one event convention. Everything an extension offers goes
through these, so a host — and a person looking at the plugin graph — can see
what a server is made of before anything runs.

@module reactor_mcp_server.points
"""

from __future__ import annotations

from reactor import define_contribution_point

#: The tools. Contributions are :class:`~reactor_mcp_server.tools.ToolSpec`,
#: each contributed under its own name so another extension can extend it by
#: name (``contributions.extend(TOOLS, "launch_sandbox", ...)``).
TOOLS = define_contribution_point("mcp.tools")

#: The toolsets: :class:`~reactor_mcp_server.toolsets.Toolset`, the named
#: groups a URL switches on.
TOOLSETS = define_contribution_point("mcp.toolsets")

#: MCP resources. Contributions are callables taking the server, because the
#: SDK's resource decorators carry more shapes than a spec would usefully
#: describe and nothing here needs to reason about a resource.
RESOURCES = define_contribution_point("mcp.resources")

#: MCP prompts, the same way.
PROMPTS = define_contribution_point("mcp.prompts")

#: The protected resource this server is, for OAuth (RFC 9728): one
#: :class:`~reactor_mcp_server.oauth.ProtectedResource` per host, contributed
#: under a name so a deployment can read which plugin said what it is.
PROTECTED_RESOURCES = define_contribution_point("mcp.auth.resources")

#: What verifies a bearer token: the MCP SDK's ``TokenVerifier`` (an object
#: with ``verify_token``) or an async callable taking the token and answering
#: an ``AccessToken`` or ``None``. Several are asked in their declared order
#: and the first one that knows the token answers — a deployment accepting a
#: personal key beside its authorization server's tokens contributes both.
TOKEN_VERIFIERS = define_contribution_point("mcp.auth.verifiers")

#: Other ways in: callables taking the ASGI scope and answering whether a
#: request **without a bearer token** is served all the same — a server that
#: is open to anybody, a deployment that also takes a key in a header of its
#: own. A request none of them admits gets the ``401`` challenge.
ADMISSIONS = define_contribution_point("mcp.auth.admissions")

#: The entry-point group MCP extensions are discovered on.
ENTRY_POINT_GROUP = "reactor.mcp.extensions"


def on_toolset(name: str) -> str:
    """The activation event fired when a toolset is asked for.

    An extension whose tools are opt-in declares this and stays unregistered —
    contributing nothing, costing nothing — until a URL names its toolset::

        PluginManifest(
            name="benchmarks",
            version="1.0.0",
            activation_events=[on_toolset("benchmarks")],
        )
    """
    if not name:
        raise ValueError("A toolset activation event needs a toolset name")
    return f"onToolset:{name}"
