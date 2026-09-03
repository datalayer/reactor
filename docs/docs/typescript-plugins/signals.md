---
sidebar_position: 9
title: Signals
---

# Signals

Plugin outputs are frequently reactive: a plugin builds a service, and other
plugins — or the UI — need to follow what that service holds. The runtime ships
signal primitives so a plugin can expose that without every consumer inventing a
subscription.

```ts
import { signal, computed, effect, batch, untracked } from '@datalayer/reactor';

const count = signal(0);
const doubled = computed(() => count.value * 2);

effect(() => {
  console.log(doubled.value);
});

batch(() => {
  count.value = 1;
  count.value = 2;   // one notification, not two
});

untracked(() => count.value);   // read without becoming a dependency
```

## Named signals on a plugin's output

`namedSignals` and `watchedSignal` are for the case where a plugin's build
output is a set of reactive values that a host wants to enumerate rather than
know in advance — the same reason contribution points carry records rather than
components.

```ts
definePlugin({
  name: '@app/status',
  build() {
    return namedSignals({
      connection: 'disconnected',
      queueDepth: 0,
    });
  },
});
```

`batch` is the primitive that keeps a burst of writes to one revision bump, and
it is the same guarantee the lifecycle gives: a plugin contributing five views
during `register` wakes subscribers once.
