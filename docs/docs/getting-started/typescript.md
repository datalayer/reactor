---
sidebar_position: 1
title: TypeScript
---

# Getting started in TypeScript

## Install

```bash
npm install @datalayer/reactor
```

`react` and `react-dom` (>= 18) are peer dependencies, and only needed if you
use the React bindings.

## Build from source

```bash
npm install
npm run build
```

`npm run build` builds the runtime (`lib/`) and the
[bundled plugins](/core-plugins/) under `plugins/`.

## A plugin, a platform, a start

```ts
import { buildReactorFromPlugins, definePlugin } from '@datalayer/reactor';

const DemoPlugin = definePlugin({
  name: '@demo/core',
  build() {
    return { message: 'hello' };
  },
});

const reactor = buildReactorFromPlugins([DemoPlugin]);
reactor.start();
```

That is the whole minimum: a name, something to build, and a platform to run it
on.

## Core vs React

The runtime is framework-agnostic; the React integration is a separate entry
point, so a backend-for-frontend or a CLI can use the same platform without
pulling React in.

```ts
import { definePlugin } from '@datalayer/reactor';        // core runtime
import { ReactorSlot } from '@datalayer/reactor/react';   // React bindings
```

## Where to go next

| You want to | Read |
| --- | --- |
| declare a plugin properly, with presentation metadata | [Plugins](/typescript-plugins/plugins) |
| understand phases, `enable`/`disable` and disposal | [Lifecycle](/typescript-plugins/lifecycle) |
| let plugins offer things the app chooses between | [Contribution points](/typescript-plugins/contribution-points) |
| ship several plugins as one capability | [Extensions](/typescript-plugins/extensions) |
| not load a plugin until something asks | [Activation events](/typescript-plugins/activation-events) and [Lazy loading](/typescript-plugins/lazy-loading) |
| render all of it | [React bindings](/typescript-plugins/react) |
