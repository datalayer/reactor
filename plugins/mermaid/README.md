[![Datalayer](https://images.datalayer.io/legacy/datalayer-25.svg)](https://datalayer.ai)

# 🧜 `@datalayer/reactor-mermaid`

Mermaid diagrams as tools an AI agent writes, checks and renders, for any
application built on `@datalayer/reactor`.

## The tools

| Tool | What it does |
| --- | --- |
| `mermaidSetDiagram` | creates a diagram, or replaces the source of one by id. The source is checked with Mermaid's parser first: a source that does not parse is refused with the parser's message and line, and the diagram shown stays as it was |
| `mermaidReadDiagram` | one diagram's source, title and type |
| `mermaidListDiagrams` | the diagrams there are, with id, title, type and line count |
| `mermaidValidate` | checks a source without keeping it: valid or not, its type, and the errors, each with its line and what the parser expected |
| `mermaidRenderSvg` | SVG markup, from a diagram's id or from source given directly |
| `mermaidListDiagramTypes` | every diagram type, with its keyword, what it is for and a small valid example |

Each is named `datalayer_<tool>` for the model, with its Zod schema and the
operation that validates a call.

## Mermaid itself is handed in

The page that shows diagrams has Mermaid already, at the version it chose and
initialised with its theme. The tools use two calls of its API, and the
`mermaid` module's default export has both, so a host passes it as it is:

```ts
import mermaid from 'mermaid';
mermaid.initialize({ startOnLoad: false });
```

Which type a source is (`detectDiagramType`), and the list of types, are read
from the source's first word, after any front matter, directive or comment,
without Mermaid.

## Using it

```ts
import { buildReactorFromPlugins, configurePlugin } from '@datalayer/reactor';
import { MermaidPlugin, createMemoryDiagramHost } from '@datalayer/reactor-mermaid';

const diagrams = createMemoryDiagramHost({ onChange: (id) => redraw(id) });
const reactor = buildReactorFromPlugins([
  configurePlugin(MermaidPlugin, { host: diagrams, engine: mermaid }),
]);
// The `AgentTools` bundle `mermaid` names the commands `mermaid.<operation>`.
```

Without a platform, `createMermaidToolHandlers(host, engine)` and
`createMermaidExecutor(handlers)` run the same tools through
`mermaidTools.operations`.

A host keeps diagrams by id: list, read, write and insert.
`createMemoryDiagramHost()` is one, for a page with a diagram view.

## Testing

From the repository root: `npm run test:ts` runs `plugins/mermaid/__tests__`,
including a pass against Mermaid's own parser (in jsdom) that checks the
examples the type listing offers.
