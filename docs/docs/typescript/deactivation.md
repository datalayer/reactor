---
sidebar_position: 6
title: Deactivation
---

# Deactivation

The mirror image of [activation](/typescript/activation-events), and the reason
it is not just `disable()`.

```ts
definePlugin({
  name: '@app/document-mode',
  activationEvents: [onView('document')],
  deactivationEvents: [onView('notebook')],   // stand down when we leave
});

await reactor.fire(onView('notebook'));
// → { deactivated: ['@app/document-mode'], activated: ['@app/notebook-mode'] }
```

Deactivation runs **before** activation within one `fire`, so a single event
retires the old thing and brings up the new. The other order would leave both
running for a beat — which a host reading a contribution point in between would
see.

## Three states, not two

This is the distinction the whole feature rests on:

| | who decided | comes back on an event? | keeps its module? |
| --- | --- | --- | --- |
| **not activated** | nobody yet — its condition has not been met | yes | not fetched yet |
| **deactivated** | the platform: the reason for running has passed | yes | yes |
| **disabled** | a person, with a checkbox | **no** | yes |

Collapse deactivated into disabled and you get one of two bugs: an event
silently overrides somebody's checkbox, or a plugin that stood down can never
come back. So `fire()` never revives a disabled plugin — it records that the
condition was met, and `enable()` is what runs the phases.

## Dependants stand down first

`reactor.deactivate(name)` does it directly. Either way, dependants stand down
first, transitively: a dependant left running against a deactivated dependency
is holding contributions nobody maintains.

```ts
reactor.deactivate('@app/base');   // '@app/top', then '@app/middle', then '@app/base'
```

What survives: its place in the list, its manifest, its module, its enabled
flag, and — if it declared [`preserveOutput`](/typescript/lifecycle) — what it
built. What goes: its contributions, and its `register` / `afterRegistration`
disposers run.

## One subtlety

A contribution point fires its activation event only once, so that a module
which failed to load is not refetched on every render. Standing a plugin down
lifts that guard **for the points that plugin waits on, and no others** —
otherwise a plugin woken by a read could never be woken by a read again.

## Opposite defaults, deliberately

```ts
activationEvents: []     // → at startup. A plugin with no opinion should run.
deactivationEvents: []   // → never.      A plugin with no opinion should keep running.
```

Point them the same way and the first event anybody fires tears down every
plugin that said nothing.
