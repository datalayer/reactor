---
sidebar_position: 2
title: Cross-tier activation and deactivation
---

# Activation and deactivation should carry to dependants

**Tracking: [datalayer/reactor#10](https://github.com/datalayer/reactor/issues/10)**

## The problem

Switching a plugin should switch what depends on it — including across the wire.

Today the two halves of that are in different states:

| | Within one tier | Across the tiers |
| --- | --- | --- |
| **Deactivation** | [dependants stand down first, transitively](/typescript/deactivation) | not carried |
| **Activation** | dependencies activate first | not carried |

`reactor.deactivate('@app/base')` already stands `@app/top` and `@app/middle`
down before `@app/base`, because a dependant left running against a deactivated
dependency is holding contributions nobody maintains. The Python tier does the
same with `platform.deactivate_plugin`.

What neither does is cross the wire. Disabling the Python `catalog` plugin in the
[music example](/examples/music/switching-plugins) makes the catalog and shop
cards vanish — but only because those React plugins each declared
`requiredBackendPlugins: ['catalog']` and the application wired an
`isBackendPluginAvailable` predicate. The *frontend plugins themselves* are still
enabled and still activated; it is their rendering that is gated.

That gap is visible in exactly one place, and it is the honest one: the plugin
list says a plugin is on while nothing it contributes is on screen.

## What already points the right way

- **The relationship is already declared.** `requiredBackendPlugins` /
  `optionalBackendPlugins` on one side, `frontend_dependencies` /
  `optional_frontend_dependencies` on the other — see
  [Across the tiers](/cross-tier/declaring-dependencies). The graph can already
  be drawn; what is missing is acting on it.
- **The vocabulary is already shared.** `fire_event` on both tiers returns
  `{"deactivated": [...], "activated": [...]}`. A cross-tier fire has an obvious
  shape: the same answer, from both.
- **The three states are already distinct.** *Not activated*, *deactivated* and
  *disabled* [mean different things](/typescript/deactivation), and a cross-tier
  cascade must preserve that: a server-side event must never silently override a
  person's checkbox in the browser.

## What has to be designed

- **Which direction propagates, and how far.** A required backend plugin going
  down should stand its frontend dependants down. Whether the reverse holds is
  less obvious: a backend that deactivated itself because no browser had loaded
  its counterpart would be [refusing for the wrong
  reason](/cross-tier/declaring-dependencies).
- **A transport.** Today the browser polls `GET /plugins` after a toggle. A
  cascade needs the server to say what changed — which is a push, and therefore a
  connection this project does not currently require.
- **Ordering across the wire.** Deactivation runs before activation within one
  `fire` so that a single event retires the old and brings up the new. Two
  processes make that a distributed ordering problem rather than a loop.
- **Failure.** A tier that cannot be reached is not a tier that said no. The
  answer has to distinguish them, or a network blip disables half an
  application.
