[![Datalayer](https://images.datalayer.io/legacy/datalayer-25.svg)](https://datalayer.ai)

# 🖌️ `@datalayer/reactor-excalidraw`

Excalidraw drawings as tools an AI agent draws with, for any application built
on `@datalayer/reactor`.

## What is in it

- **Eleven tools** (`ToolDefinition`s from `@datalayer/reactor/tools`), each
  with its Zod schema and the operation that validates a call:

  | Tool | What it does |
  | --- | --- |
  | `excalidrawInsertNode` | a new drawing, optionally with its shapes |
  | `excalidrawFromMermaid` | Mermaid source turned into real, editable shapes |
  | `excalidrawListDrawings` | the drawings there are, with what each holds |
  | `excalidrawReadScene` | every element of one drawing, with its id |
  | `excalidrawAddElements` | shapes added, arrows bound to shapes already there |
  | `excalidrawUpdateElements` | move, resize, recolour, relabel by element id |
  | `excalidrawConnectElements` | a bound arrow between two shapes |
  | `excalidrawDeleteElements` | shapes removed, with their labels, arrows detached |
  | `excalidrawSetAppState` | the canvas colour and grid |
  | `excalidrawResize` | how large the drawing is rendered |
  | `excalidrawClearScene` | the drawing emptied, kept |

  Each is named `datalayer_<tool>` for the model.

- **A pure scene model** (`parseScene`, `serializeScene`, `describeScene`,
  `withBoundText`, `touchElement`…) and pure scene changes (`addToScene`,
  `updateInScene`, `deleteFromScene`, `connectInScene`, `setCanvas`): plain
  objects in, plain objects out, no editor, no browser.

- **Handlers over a host.** `createExcalidrawToolHandlers(host, converters)`
  runs the tools against whatever keeps the drawings. A host is five methods:
  list, read, write, insert, resize. `createMemoryDrawingHost()` is one, for a
  page with a canvas or two.

- **The reactor plugin.** `ExcalidrawPlugin` registers each tool's operation as
  a command, `excalidraw.<operation>`, and contributes the `AgentTools` bundle
  `excalidraw` that names them, so a host that mounts the plugin hands an
  agent the tools without declaring any.

## Excalidraw itself is handed in

The package does not depend on `@excalidraw/excalidraw`, a browser bundle
several megabytes wide. The host that renders drawings has it already, and
passes the two conversions the tools need:

```ts
import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import { parseMermaidToExcalidraw } from '@excalidraw/mermaid-to-excalidraw';
```

`parseMermaidToExcalidraw` is optional. Without it, `excalidrawFromMermaid`
says the host does not convert Mermaid.

## Using it

As a reactor plugin:

```ts
import { buildReactorFromPlugins, configurePlugin } from '@datalayer/reactor';
import { ExcalidrawPlugin, createMemoryDrawingHost } from '@datalayer/reactor-excalidraw';

const drawings = createMemoryDrawingHost({ onChange: (id) => redraw(id) });
const reactor = buildReactorFromPlugins([
  configurePlugin(ExcalidrawPlugin, {
    host: drawings,
    converters: { convertToExcalidrawElements, parseMermaidToExcalidraw },
  }),
]);
```

Or directly, without a platform, in a host with its own tool registry:

```ts
import {
  excalidrawTools,
  createExcalidrawToolHandlers,
  createExcalidrawExecutor,
} from '@datalayer/reactor-excalidraw';

const executor = createExcalidrawExecutor(createExcalidrawToolHandlers(myHost, converters));
await excalidrawTools.operations.excalidrawReadScene.execute(
  { blockId: 'drawing-1' },
  { executor, documentId: 'page' },
);
```

`@datalayer/jupyter-lexical` is such a host: its drawings are
`ExcalidrawNode`s in a Lexical document, its host maps a drawing's id to the
node's key, and the node, the editor extension and the components stay in
Lexical as the editor-side binding over these operations.

## Three rules the handlers keep

- **Ids are the contract.** Every skeleton gets an explicit id and is
  converted with `regenerateIds: false`, so an id a caller chose, or read back
  from a scene, keeps working in the next call.
- **Bindings are not decoration.** An arrow is bound at each end that names a
  shape, one or both, and listed in that shape's `boundElements`; a free end
  keeps the point it was asked for. Its label sits on the arrow as it finally
  runs. A shape that moves or changes size brings its label and its arrows
  along in the same edit.
- **One edit of a drawing at a time.** Each read-change-write waits for the
  ones asked before it on the same drawing of the same host, so two parallel
  calls both land. A host that builds a new host object per call should keep
  one per document, as the queue is the host's.

## Testing

From the repository root: `npm run test:ts` runs `plugins/excalidraw/__tests__`.
