---
sidebar_position: 5
title: Commands Registry
---

# The command registry

A command is a named thing somebody can invoke: *Play a random song*, *Clear the
playlist*, *Publish this draft*. Plugins register them, the application decides
how they are reached, and the reactor knows about no surface at all.

The registry exists on both tiers — `@datalayer/reactor` and `reactor.commands`
— because the two halves should not disagree about what a plugin can offer.

## Why a registry and not a contribution point

The reactor already has a mechanism for "plugins offer, the host chooses":
[contribution points](/overview/slots-vs-contribution-points). Commands are not
one, and the difference is not cosmetic.

A contribution is **data the host reads and interprets**. A command is
**behaviour the host invokes without interpreting it**. Every host would
otherwise reimplement the same three things — look one up by id, run it and
catch what it throws, drop the ones whose plugin went away — and each would get
the error handling slightly wrong.

Registering a command also gets you every surface at once. The same registration
appears in the [command palette](/core-plugins/commands) and in `reactor commands
list` on the terminal, because the registry is in the core rather than in
whichever surface happened to need it first.

## What a command is

| Field | |
| --- | --- |
| `id` | stable, unique identity — `music.playRandom`, not the label |
| `name` | what a person reads |
| `description` | one line, shown beside the name where there is room |
| `octicon` | an [Octicon](https://primer.style/foundations/icons) name |
| `emoji` | for surfaces with no icon set |
| `category` | groups related commands; the reactor never interprets it |
| `keybinding` | text to *display*; the reactor listens to no keyboard |
| `order` | lower sorts first, ties keep registration order |
| `isEnabled` | whether it can run right now |
| `execute` | do the thing; may be async, may throw |

Presentation sits beside behaviour deliberately. A palette needs a label, an icon
and a description *before* anything runs, and a command carrying only a function
forces every surface to keep a parallel table of labels — which then drifts.

Ids are namespaced by convention and **registering one twice is refused**, not
silently overwritten: two plugins fighting over an id is a bug, and the one that
lost would otherwise fail invisibly.

## TypeScript

Declare commands on the plugin when they need nothing from the build:

```ts
import { definePlugin } from '@datalayer/reactor';

export const ShopPlugin = definePlugin({
  name: '@music/shop',
  commands: [
    {
      id: 'music.shop.clearCart',
      name: 'Clear the cart',
      description: 'Remove every song from the cart',
      emoji: '🧹',
      category: 'Shop',
      isEnabled: () => Object.keys(useCart.getState().lines).length > 0,
      execute: () => useCart.getState().clear(),
    },
  ],
});
```

Register imperatively when a command closes over build output, or appears later:

```ts
register(ctx) {
  return ctx.registerCommand({
    id: 'music.play',
    name: 'Play',
    execute: () => ctx.state.getOutput()!.player.play(),
  });
}
```

The returned disposer is idempotent, and **everything a plugin registered is
disposed when it stops or is disabled** — so the ordinary case needs no disposer
at all.

Reading and running, from the reactor or from React:

```ts
reactor.listCommands();              // ordered, with the plugin that registered each
reactor.getCommand('music.play');
await reactor.executeCommand('music.play');
```

```tsx
import { useCommands, useReactorPlatform } from '@datalayer/reactor/react';

const commands = useCommands();      // re-reads when the reactor changes
```

## Python

The hook is `provide_slash_commands`. The host passes the registry as this
plugin sees it, so a plugin never names itself:

```python
class CatalogPlugin:
    def provide_slash_commands(self, commands) -> None:
        commands.add(
            "catalog.describe",
            "Describe the catalog",
            describe_catalog,
            description="How many songs there are, and who is on them",
            emoji="🎵",
            category="Catalog",
        )
```

`commands.add(...)` is shorthand; `commands.register(Command(...))` takes the
dataclass when you want to build one up. Reading and running:

```python
platform.list_commands()          # Command objects, tenant-filtered
platform.describe_commands()      # the same as JSON, for an HTTP palette
await platform.execute_command("catalog.describe")
```

`execute` is always awaitable, even for a synchronous handler, so a caller never
has to ask which kind it invoked. A handler that takes no parameter is called
with none.

## Unavailable is not hidden

`isEnabled` is asked at read time, so *Clear the playlist* can be greyed out
while the playlist is empty. A command that is unavailable is still **listed**:
hiding it makes the application look like it lost a feature, and telling somebody
why they cannot do something is more useful than pretending it was never there.

A predicate that raises counts as unavailable rather than taking the palette
down with it.

## Failure

`executeCommand` rejects when there is no such command, when it is currently
unavailable, or when the command itself throws. It never swallows the error and
never takes down the surface that invoked it: the caller decides what a failed
command looks like, because only it knows where to say so. The palette, for
instance, shows the message and stays open with the query intact.

On the Python tier a command belonging to a plugin the tenant may not use reads
as *no such command* rather than as *not allowed* — a tenant should not learn
what it cannot have.
