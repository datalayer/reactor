[![Datalayer](https://assets.datalayer.tech/datalayer-25.svg)](https://datalayer.io)

# 🌀 Reactor Plugins

Plugins that ship as their own packages, for any application built on
`@datalayer/reactor` to install.

## Why this folder exists

`examples/` and `plugins/` answer different questions.

An **example** exists to be read. The music example is a whole application —
plugins, a backend, a store to shop in — written so that someone can see how the
pieces fit. It is not meant to be installed; its plugins know about each other,
about a song catalog, and about a FastAPI service that only exists to make the
example run.

A **plugin here** exists to be used. It solves one problem for an application
nobody has written yet, so it may not assume anything about the host beyond the
reactor itself. In practice that means:

- **No dependency on any example.** A plugin that imports from
  `@datalayer-examples/*` cannot be installed by anyone.
- **No dependency on a particular backend.** Where the reactor's management API
  lives is the host's business, and arrives as a prop or config.
- **What the plugin cannot know, it is told.** State the host already owns — a
  plugin list, an address, a selection — is accepted rather than fetched a
  second time, so the plugin and the host can never disagree.
- **It works with less.** Every one of those inputs is optional, and leaving one
  out degrades the plugin rather than breaking it.

## What is here

| Package | What it does |
| --- | --- |
| [`graph`](./graph) — `@datalayer/reactor-graph` | Draws the plugin graph: dependencies, contribution points and their extenders, across the frontend and backend tiers |
| [`manager`](./manager) — `@datalayer/reactor-manager` | Lists every plugin in the platform and switches each one on and off while the application runs |

## How the two fit together

The manager renders a sidebar, and everything in that sidebar besides the list
is contributed to its `manager-actions` slot. That is not decoration: the graph
plugin puts its own "View plugin graph" button there, so switching the graph
plugin off takes the button with it.

Hosts used to draw that button themselves, beside the plugin list. It then
outlived the thing it opened — switch the graph off, press the button, land on
an empty page. A button belongs to whatever it opens.

```tsx
const reactor = buildReactorFromPlugins([
  PluginsManagerPlugin,
  GraphPlugin,
  /* your own */
]);

// The manager forwards whatever it is given to the plugins contributing
// actions. Routing is the usual case: only the application knows its own
// addresses, and the graph's button reads the two props it recognises.
<ReactorSlot
  slot="sidebar"
  props={{ showingGraph, onToggleGraph }}
/>;
```

One list, not two. A host that had its own plugin panel should retire it
rather than mount both: the music example did briefly, and the sidebar showed
two identical "Plugins" rows switching the same things. What its panel kept is
the half nothing generic can know about — the Python plugins on the other side
of the wire.

Which plugins a person may switch off is the host's call:
`configurePlugin(PluginsManagerPlugin, { protected: ['@your/shell'] })`. The
manager protects itself by default — switching off the only way back is a trap
— and a protected plugin is shown with its switch fixed rather than hidden,
because someone looking for a plugin should find it either way.

## Using one

```bash
npm install @datalayer/reactor-graph
```

```tsx
import { buildReactorFromPlugins } from '@datalayer/reactor';
import { ReactorSlot, useReactor } from '@datalayer/reactor/react';
import { GraphPlugin } from '@datalayer/reactor-graph';

const reactor = buildReactorFromPlugins([GraphPlugin, /* your own */]);

export function App() {
	useReactor(reactor);
	// Everything the plugin cannot know, it is given. Both are optional: with
	// neither, it draws the frontend platform on its own.
	return (
		<ReactorSlot
			slot="graph"
			props={{ backendUrl: 'http://localhost:8799', backendPlugins }}
		/>
	);
}
```

The graph is **derived, not drawn**: every edge comes from something a plugin
already had to declare in order to work — a dependency, a required backend
plugin, an contribution point it offers, a contribution it makes. There is nothing
to keep up to date, which is the only kind of diagram that stays true.

`describePluginGraph` in `@datalayer/reactor` does that derivation and returns
plain nodes and edges, with no geometry or colour on them. This package draws
them with echarts. The split is deliberate: a plugin framework has no business
depending on a charting library, and anyone who would rather render the same
graph with SVG, Graphviz or a terminal can call the derivation and ignore this
package entirely.

## Adding one

A plugin here is an ordinary npm package whose `main` is a module exporting a
`ReactorPlugin`. Give it:

- a `package.json` naming it `@datalayer/reactor-<thing>`, with
  `@datalayer/reactor` as a dependency,
- a `tsconfig.json` (copy a neighbour's),
- a `src/index.tsx` exporting the plugin and any component or hook a host
  would reasonably want to use directly.

Declare how it presents itself — `displayName`, `description`, `octicon`,
`emoji` — so a host that lists plugins has something to show, and say what it
needs from the other tier with `requiredBackendPlugins` and
`optionalBackendPlugins`. A plugin that describes itself is one a host can
render without being taught about it.
