---
sidebar_position: 5
title: Activation events
---

# Activation events

A plugin that is installed is not therefore running. Between the two sits a
declared condition, and the reactor holds the plugin — module unfetched,
contributing nothing — until it is met.

```ts
const HeavyPlugin = defineLazyPlugin({
  name: '@app/heavy',
  displayName: 'Heavy',
  activationEvents: [onView('heavy')],   // not at startup: when this happens
  load: () => import('./heavy'),
});

await reactor.fire(onView('heavy'));   // now it loads, and activates
```

Declaring nothing means "at startup", so a plugin without an opinion behaves
exactly as it did before activation events existed. `'*'` matches everything.

## Reading a contribution point is itself an event

This is the one worth understanding, because it inverts the dependency:

```ts
const ToolbarItems = defineContributionPoint<Item>('app.toolbar');

const LatePlugin = defineLazyPlugin({
  name: '@app/late',
  activationEvents: [onContributionPoint(ToolbarItems)],
  load: () => import('./late'),
});
```

The toolbar renders, reads its items, and that read fetches every plugin that
was waiting to fill it. The toolbar named none of them; the plugins named no
toolbar. Neither imports the other, and nothing loads until something looks.

The read stays synchronous and answers with what is there now; the late arrivals
bump the revision, which is what every host is already subscribed to. Activation
triggered by a read is deferred to a microtask on purpose — a read happens
during render, and activating inline would wake subscribers in the middle of
rendering the component that asked.

## Properties worth knowing

| Situation | What happens |
| --- | --- |
| a plugin waits on an event that never fires | it stays listed, described and drawable, and its module is never fetched |
| something depends on a waiting plugin | the dependency is activated first, whatever it was waiting for |
| two of its events fire | it activates once |
| an event nobody waits on fires | nothing, at no cost — fire liberally rather than checking first |
| `stop()` then `start()` | activation is undone and the phases run again |

## In React

`useReactorEvent(onView(activeViewType))` wires the application's own state to
the events plugins wait on — one line, and switching views both wakes the
arriving view's plugins and stands down the departing view's.

## On the Python tier

The same vocabulary — `activation_events`, `platform.fire_event(event)`,
`on_contribution_point` — with one difference: activation there is
[synchronous](/python/extensions-and-events), because no module is on the wire,
so the plugins a read wakes are in the list that read returns.
