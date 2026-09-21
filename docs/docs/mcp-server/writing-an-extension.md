---
sidebar_position: 6
title: Writing an Extension
---

# Writing an extension

An MCP extension is a distribution that publishes one entry point. A host that
installs it serves its tools; a host that does not, does not. Nothing in
either names the other.

## The class

```python
from reactor import PluginCompatibility, PluginManifest
from reactor_mcp_server import McpExtension, Toolset, tool


class Benchmarks(McpExtension):
    """Read what a benchmark run did."""

    def manifest(self) -> PluginManifest:
        return PluginManifest(
            name="benchmarks",
            version="1.0.0",
            description="Read a benchmark's tasks, scores and trajectories.",
            author="Your Name",
            tags=["benchmarks", "evaluation"],
            compatibility=PluginCompatibility(api_version="v1"),
        )

    def toolsets(self) -> tuple[Toolset, ...]:
        return (
            Toolset(
                name="benchmarks",
                description="Read what a benchmark run did.",
                default=False,
            ),
        )

    @tool(title="Read Benchmark")
    async def read_benchmark(self, uid: str) -> dict:
        """Read a benchmark's definition: its tasks and how each is graded."""
        return await fetch(uid)
```

Everything has a default, so an extension that only adds two tools writes only
the tools.

| Override | When |
| --- | --- |
| `manifest()` | Always. It is what a host reads before running anything. |
| `tools()` | For tools built at run time. The default collects `@tool` methods. |
| `tool_extensions()` | To narrow, wrap or re-describe [another extension's tool](/mcp-server/extending-a-tool). |
| `toolsets()` | To name the group, make it opt-in, or add to somebody else's. |
| `resources()` / `prompts()` | Callables that register MCP resources or prompts on a server. |
| `on_server(server)` | To act on a built server — see [The host](/mcp-server/host). |
| `on_start()` / `on_stop()` | To acquire and release what the extension holds. |

## Publishing it

```toml
[project]
name = "my-mcp-benchmarks"
version = "1.0.0"
dependencies = ["reactor_mcp_server>=1.0.2"]

[project.entry-points."reactor.mcp.extensions"]
benchmarks = "my_mcp_benchmarks:Benchmarks"
```

The entry point may be the class, a factory, or an instance — a callable is
called, anything else is used as it is. One group, so a distribution carrying
several extensions lists them all and a host loads them by name.

Being installed is all it takes:

```bash
pip install my-mcp-benchmarks
reactor-mcp-server            # its tools are there, under ?benchmarks
```

## Holding state

An extension is an object, so state lives on it. Make it public if anything
downstream needs it — the alternative is somebody else's code reaching for a
private attribute, which works until you store it differently:

```python
class Sandboxes(McpExtension):
    def __init__(self) -> None:
        self._manager = SandboxManager()

    @property
    def sandboxes(self) -> SandboxManager:
        """The sandboxes this extension launched, for extensions built on it."""
        return self._manager

    def on_stop(self) -> None:
        self._manager.terminate_all()
```

A downstream extension reaches it through the host rather than by importing:

```python
extension = manager.get("sandboxes")
registry = getattr(extension, "sandboxes", None)
```

`None` for a name that is not registered is an ordinary configuration, not an
error: the caller degrades — leaving its tool off the list — rather than
failing a server's startup.

## Testing it

Without a server, because a tool is an ordinary function:

```python
async def test_it_lists_what_the_platform_has(monkeypatch):
    extension = Benchmarks()
    assert await extension.read_benchmark("evs-1") == {...}
```

With one, when what is under test is the *serving*:

```python
from reactor_mcp_server import build_host, parse_selection

host = build_host([Benchmarks()], name="tests")
built = host.build(parse_selection("only=benchmarks"))
assert "read_benchmark" in built.tool_names
```

And end to end, with a real client over HTTP, when what is under test is the
protocol — [Serving](/mcp-server/serving) has the shape of it.

## A checklist before publishing

- **Every tool answers all four annotations.** A listing that says nothing is
  read as "not idempotent, open world", so a client retries nothing and asks
  before every read.
- **The docstring is what a model reads.** Write it for the model, not for the
  reader of the code, or pass `description=`.
- **Name the toolset for its subject**, not for your package — see
  [Toolsets](/mcp-server/toolsets).
- **Declare an activation event** if the toolset is opt-in, so the extension
  costs nothing until somebody asks for it.
- **Pin a floor** on `reactor_mcp_server`: an extension installed beside a
  host too old to read its group is present and absent at once.
