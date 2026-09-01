[![Datalayer](https://assets.datalayer.tech/datalayer-25.svg)](https://datalayer.io)

[![Become a Sponsor](https://img.shields.io/static/v1?label=Become%20a%20Sponsor&message=%E2%9D%A4&logo=GitHub&style=flat&color=1ABC9C)](https://github.com/sponsors/datalayer)

# 🌀 Reactor

Build extensible frontend (JavaScript) and backend (Python) with a dependency injection solution inpsired by VS Code, Eclipse (OSGI) and other historical solutions.

[![Reactor Example Music](https://images.datalayer.io/products/reactor/reactor-example-music.png)](https://reactor.datalayer.tech)

Reactor provides two sibling packages:

- `@datalayer/reactor` (TypeScript): Plugin runtime with a framework-agnostic core and separate React integration.
- `datalayer_reactor` (PyPI distribution, imported as `reactor`): FastAPI + pluggy plugin reactor for modular extensibility.

Both tiers implement the same architecture. That is the point of writing it down
once: a host that lists, describes, groups or draws plugins should never have to
ask which side of the wire one came from.

## 📖 Documentation

**[reactor.datalayer.tech](https://reactor.datalayer.tech)** — everything is
there, and only there. Source in [`docs/`](./docs).

| | |
| --- | --- |
| [Why Reactor](https://reactor.datalayer.tech/overview/why) | what this targets that a hook callback does not |
| [Architecture](https://reactor.datalayer.tech/overview/architecture) | the seven constructs, and the two distinctions the model rests on |
| [Get started in TypeScript](https://reactor.datalayer.tech/getting-started/typescript) · [in Python](https://reactor.datalayer.tech/getting-started/python) | install, and a plugin running |
| [TypeScript runtime](https://reactor.datalayer.tech/typescript/) | plugins, lifecycle, contribution points, extensions, activation, lazy loading, React bindings, signals |
| [Python runtime](https://reactor.datalayer.tech/python/) | manifests, contribution points, extensions, tenants, the HTTP API |
| [Across the tiers](https://reactor.datalayer.tech/cross-tier/declaring-dependencies) | what a plugin may declare about its counterpart, and why it is not enforced |
| [Roadmap](https://reactor.datalayer.tech/roadmap/) | federation, cross-tier activation, Python-packaged extensions, shadcn/ui |

### 🎵 The music store, running in the page

**[reactor.datalayer.tech/examples/music/demo](https://reactor.datalayer.tech/examples/music/demo)**
— a store assembled entirely from plugins, with a switch per plugin on both
tiers. Untick one and watch what it contributed leave.

## Repository layout

| Path | What is in it |
| --- | --- |
| `src/` | TypeScript package source for `@datalayer/reactor` |
| `reactor/` | Python package source for `datalayer_reactor` |
| `plugins/` | reusable plugins shipped alongside the runtime — the [manager](https://reactor.datalayer.tech/plugins/manager) and the [graph](https://reactor.datalayer.tech/plugins/graph) |
| `examples/` | the demos, including [the music store](./examples/music) |
| `docs/` | the documentation site |

## Develop

```bash
# TypeScript: the runtime and the bundled plugins.
npm install
npm run build
npm test
npm run typecheck

# Python.
python -m venv .venv
source .venv/bin/activate
pip install -e .
python -m reactor

# The music example, both tiers.
make music

# The documentation site.
cd docs && make install && make start
```

## Release

See [RELEASE.md](./RELEASE.md).
