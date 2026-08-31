---
sidebar_position: 4
title: shadcn/ui examples
---

# shadcn/ui examples

**Tracking: [datalayer/reactor#11](https://github.com/datalayer/reactor/issues/11)**
· [ui.shadcn.com](https://ui.shadcn.com)

## Status: shipped, as a different application

:::tip Shipped
[`examples/cms`](/examples/cms/) is a shadcn/ui application whose every feature
is a plugin, delivered by two Python packages — and it
[runs on this site](/examples/cms/demo), including the `pip install` that adds
the paid tier.

It answers this issue by a different route than "port the music store", and the
reason is on that page: what needed proving is not that these plugins can be
redrawn, but that a plugin need not know what kit the host uses — which the CMS
shows both by contributing records and by having its one drawing plugin borrow
the host's kit.
:::

## The problem

Every frontend example in this repository is written with
[Primer](https://primer.style) and `@datalayer/primer-addons`. That is a
reasonable house style, and it makes the examples look like the products they
came from — but it leaves one claim in this documentation untested.

The claim is that the plugin model is **independent of the UI kit**. Reactor
stores records and renders whatever components plugins hand it; nothing in
`definePlugin`, a contribution point or a slot mentions a design system.

An example is the only way to demonstrate that, because the counter-argument is
not theoretical: a plugin system whose contributions must be Primer components
has an undeclared dependency, and its plugins are only portable in the sense that
they compile.

## What this should show

- **The same store, on a second design system.** Re-implementing the
  [music example](/examples/music/) rather than inventing a new demo, so the two
  can be read side by side and the diff *is* the answer.
- **A mixed platform.** The more interesting version is one shell hosting
  plugins written against two different kits at once — which is the honest test,
  since a marketplace cannot dictate a design system to third parties.
- **Where a design system legitimately becomes a dependency.** Theming, portals
  and overlays are the awkward cases: the music example's header renders its cart
  in a Primer overlay, which is why it calls `setupPrimerPortals()`. Whatever the
  shadcn/ui equivalent is, naming it is part of the point.

## What has to be designed

- **Whether the kit belongs in a plugin's manifest.** A host that wanted to warn
  "this plugin will look wrong here" would need it declared. A host that does not
  care should not have to read it.
- **Shared singletons, again.** A design system is exactly the kind of dependency
  that must not be duplicated — the same constraint
  [federation](/roadmap/federation) has to solve for React.
