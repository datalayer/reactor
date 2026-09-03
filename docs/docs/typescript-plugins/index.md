---
sidebar_position: 0
title: What it Implements
---

# The TypeScript runtime

`@datalayer/reactor` implements:

- `definePlugin`, `defineLazyPlugin` and `configurePlugin`
- `defineExtension`, to group plugins into one installable capability
- `dependencies`, `peerDependencies`, `conflictsWith`
- ordered phases: `init` → `build` → `register` → `afterRegistration`
- runtime lifecycle control: `start`, `stop`, `enable`, `disable`
- contribution points and contributions: `defineContributionPoint`,
  `contribution`, `ctx.contribute`, `reactor.getContributions`
- activation and deactivation events: `activationEvents`, `deactivationEvents`,
  `reactor.fire`, `reactor.deactivate`, `onContributionPoint`, `onView`,
  `onCommand`
- signal primitives for reactive plugin outputs: `signal`, `computed`, `effect`,
  `batch`, `untracked`, `namedSignals`, `watchedSignal`

## Core vs React split

- Core runtime exports from `@datalayer/reactor`
- React bindings export from `@datalayer/reactor/react`

The split is what lets the same platform run in a Node service or a CLI without
React being installed. See [React bindings](/typescript-plugins/react) for the second
half.
