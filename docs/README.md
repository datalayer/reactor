[![Datalayer](https://assets.datalayer.tech/datalayer-25.svg)](https://datalayer.io)

[![Become a Sponsor](https://img.shields.io/static/v1?label=Become%20a%20Sponsor&message=%E2%9D%A4&logo=GitHub&style=flat&color=1ABC9C)](https://github.com/sponsors/datalayer)

# Reactor Docs

> Source code for the [Reactor Documentation](https://reactor.datalayer.tech), built with [Docusaurus](https://docusaurus.io).

```bash
# Install the dependencies.
make install
```

Run the python and typescript API docs by running in the reposiroty root.

```bash
make pydoc
make typedoc
```

```bash
# Development: This command starts a local development server and opens up a browser window.
# Most changes are reflected live without having to restart the server.
echo open http://localhost:3000
make start
```

```bash
# Build: This command generates static content into the `build` directory
# and can be served using any static contents hosting service.
make build
```

```bash
# Publish if you have karma for.
make publish
```

## The embedded music example

`/examples/music/demo` runs the repository's [music example](../examples/music)
inside the page — the same plugin sources, on the same runtime, with a live
Plugins panel for both tiers.

Nothing about the example is copied into this site. Three pieces make that work,
all of them in `docusaurus.config.js` and `src/components/MusicDemo`:

| Piece | What it does |
| --- | --- |
| the `reactor-music-demo` webpack plugin | aliases `@datalayer-examples/reactor-music-*` to `examples/music/*/src/index.tsx`, and `@datalayer/reactor` to `src/`, exactly as the example's own `vite.config.ts` does |
| `src/components/MusicDemo/backend.ts` | answers the four Python plugins' HTTP endpoints in the browser, so the backend half of the Plugins panel is live on a static site |
| the `@reactor-music-demo` alias | resolves to the demo in the browser and to nothing on the server, keeping a client-only widget out of the SSR bundle |

Consequences worth knowing before editing either side:

- **The site builds against the example's source**, not its build output. Editing
  a plugin under `examples/music` changes this site on the next build; the
  runtime does *not* need `npm run build` first.
- **The demo pins its theme.** The example's header contributes Datalayer's
  appearance controls; inside a documentation page they are hidden
  (`src/css/custom.css`) and the theme is fixed to `datalayer` in `auto` color
  mode.
- **The plugin graph is not embedded.** It lives behind the example's `/graph`
  route, which a page inside a docs site cannot own.

## Structure

```
docs/           the documentation itself, one directory per section
src/components/ MusicDemo — the embedded example
src/shims/      a small stand-in for @datalayer/core's BoringAvatar
static/         images
```

The sidebar is generated from the filesystem, so a new page needs no
registration — a `sidebar_position` in its front matter, and a `_category_.json`
if it starts a new section.
