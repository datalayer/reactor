---
sidebar_position: 3
title: Commands palette
---

# `@datalayer/reactor-commands`

A command palette. **Ctrl-K** (⌘K on a Mac) opens a floating bar over the
application, typing filters every command plugins have registered, and Enter
runs the one selected.

```tsx
import { CommandsPlugin } from '@datalayer/reactor-commands';

buildReactorFromPlugins([
  // …your plugins
  CommandsPlugin,
]);
```

The palette needs somewhere to mount. Render the `root` slot once, anywhere:

```tsx
<ReactorSlot slot="root" />
```

`root` is the convention for plugins that need a mount point but position
themselves — the palette portals out of wherever it lands, so it only needs
somewhere to live.

## It owns none of the commands it shows

The plugin reads the reactor's [command registry](/cross-tier/commands), which
is where commands already live. A plugin gets a palette entry by registering a
command, **not** by knowing this plugin exists:

```ts
definePlugin({
  name: '@music/shop',
  commands: [
    { id: 'music.shop.clearCart', name: 'Clear the cart', emoji: '🧹', execute: … },
  ],
});
```

That is the same split the [graph plugin](/plugins/graph) has: the framework
derives the data, the plugin draws it, and neither imports the other.

## Keyboard

| | |
| --- | --- |
| `Ctrl-K` / `⌘K` | open and close |
| `↑` `↓` | move |
| `↵` | run the selected command |
| `esc` | close |

Both modifiers are accepted rather than sniffing the platform, so a person on
either keyboard gets what they expect.

## It brings no design system

The music example is Primer and the CMS example is Tailwind, and this plugin is
used in both. A palette that imported either would be unusable in the other, and
dragging a second CSS baseline into a host is how a plugin breaks the
application it was added to.

Everything is scoped inline style driven by CSS custom properties, so a host
restyles it by setting variables and nothing leaks either way:

```css
:root {
  --dla-cmdk-bg: #fff;
  --dla-cmdk-fg: #1f2328;
  --dla-cmdk-accent: #0969da;
  --dla-cmdk-backdrop: rgba(0, 0, 0, 0.4);
  --dla-cmdk-border: rgba(0, 0, 0, 0.12);
  --dla-cmdk-selected: rgba(0, 0, 0, 0.06);
  --dla-cmdk-radius: 12px;
  --dla-cmdk-z: 1000;
}
```

Set nothing and you get a neutral light/dark pair that follows
`prefers-color-scheme`.

The bar is portalled to the document root, because a floating element rendered
inside a host's layout inherits that layout's stacking and overflow — and a
palette clipped by a sidebar is not a palette.

## Unavailable commands, and failures

A command whose `isEnabled` says no is listed and greyed out rather than hidden:
a feature that vanishes looks like a feature that was lost.

When a command throws, the palette shows the message and **stays open with the
query intact**, so a command that failed for a fixable reason can be retried. It
is where the person is looking, so it is where the failure belongs.
