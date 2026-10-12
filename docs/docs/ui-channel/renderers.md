---
sidebar_position: 2
title: Renderers and tool bindings
---

# Renderers and tool bindings

On the page, nobody owns the drawing of displays: a plugin that knows how to
draw a type contributes a renderer for it, and the host draws whatever arrives
with whichever renderer claims it.

## Contributing a renderer

`Renderers` is a contribution point; `defineRenderer` types a contribution for
React and refuses one with neither a `component` nor a `load`:

```tsx
import { contribution, definePlugin } from '@datalayer/reactor';
import { Renderers } from '@datalayer/reactor/ui';
import { defineRenderer } from '@datalayer/reactor/ui/react';

export const ApprovalsPlugin = definePlugin({
  name: '@example/approvals',
  contributes: [
    contribution(
      Renderers,
      defineRenderer({
        type: 'application/vnd.example.approval+json',
        versions: { min: 1, max: 1 },
        load: () => import('./ApprovalCard'),   // or component: ApprovalCard
      }),
    ),
  ],
});
```

`component` draws eagerly; `load` keeps the renderer out of the host's bundle
until a display of its type turns up.

The renderer is a component of `RendererProps`:

```tsx
import type { RendererProps } from '@datalayer/reactor/ui/react';

export default function ApprovalCard({ display, act, context }: RendererProps) {
  const offered = act && display.actions?.some((offer) => offer.name === 'approvals.decide');
  return (
    <article>
      <strong>{String(display.data?.title)}</strong>
      {offered ? <button onClick={() => act({ action: 'approvals.decide', payload: { approve: true } })}>Approve</button> : null}
    </article>
  );
}
```

- `display` — the display, as the wire carries it.
- `act` — presses an action the display offered; absent where nothing can be
  pressed. The renderer names the action and the payload; the host adds the
  display id and the token it was offered (see [Actions](/ui-channel/actions)).
- `upload` — uploads a file the person chose and answers its ref, to press
  with; absent where nothing can be uploaded (see [Files](/ui-channel/files)).
- `context` — whatever the host hands its renderers; a chat passes the tool
  call.

## Who draws a display

Among the renderers whose `type` matches and whose `versions` range admits the
display's version (both ends inclusive; no range admits every version), the
highest `rank` wins (default `0`), and on a tie the one registered first.
Disabling a plugin takes its renderers with it; enabling it brings them back.

```ts
import { resolveRenderer } from '@datalayer/reactor/ui';

resolveRenderer(platform, { type, version })   // the winning contribution, or undefined
```

## Drawing: `ReactorDisplay`

```tsx
<ReactorDisplay display={display} act={act} context={toolCall} loading="Loading…" />
```

draws a display with the renderer that claims it. It subscribes to
`Renderers`, so a renderer that arrives late — a lazy plugin woken by the read —
draws on the next revision, and one whose plugin is disabled stops drawing. A
`load` renderer is drawn lazily, behind Suspense and an error boundary.

With no renderer, or when a lazy renderer fails to load, it draws the
display's `text` (or `fallback`, when given): a display always says something.

It needs the platform registered with `useReactor(platform)` above it, like
any other Reactor React binding.

## Tool results

A chat draws tool calls; a tool result may be a display. `resolveToolResult`
answers which, in this order:

1. **The result carries one** in `_meta["reactor.ui/display"]` (the constant
   is `DISPLAY_META_KEY` on both tiers). An MCP tool result says exactly what
   it is. A result that is a JSON string is read as the object it encodes.
2. **A plugin bound the tool's name** to a type in `ToolBindings`:

   ```ts
   import { ToolBindings } from '@datalayer/reactor/ui';

   // A gateway may prefix the tool: `request_approval`, `mcp.request_approval`.
   contribution(ToolBindings, { tool: /(^|[_.:\-/])request_approval$/, type: 'application/vnd.example.approval+json' })
   ```

   `tool` is a name, or a pattern for a family of names. The first binding
   that names the tool wraps the raw result as a display of its type and
   `version` (default `1`), with `id` the call's id, `text` the result as text
   and `data: { toolName, result }`. A call still running has no result yet;
   the binding still names it, so a renderer can draw the call as it goes.

```ts
const display = resolveToolResult(platform, { toolName, result, toolCallId });
return display ? <ReactorDisplay display={display} context={call} /> : <DefaultToolCall call={call} />;
```

`undefined` means neither: the host draws the call its own way.

A renderer that draws both a shown display and a bound tool's result reads its
fields from `data` or from `data.result` — the
[example](/examples/ui-channel/)'s `approvalFields` does exactly that.

On the Python side, a tool that returns a display puts `display.wire()` under
`reactor.ui.DISPLAY_META_KEY` in its result's `_meta`.
