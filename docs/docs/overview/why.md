---
sidebar_position: 1
title: Why Reactor
---

# Why Reactor

Reactor targets a full plugin platform, not only hook callbacks:

- **Platform architecture** with lifecycle phases and a dependency graph.
- **Plugin marketplace metadata** and discovery primitives.
- **Third-party ecosystem support** through explicit manifest contracts.
- **Dynamic feature loading** and runtime enable/disable.
- **Modular app concerns**: interdependencies, lifecycle management,
  compatibility checks.
- **SaaS extensibility primitives**: tenant-specific plugin activation,
  sandboxed execution, versioned compatibility.

## Two tiers, one model

An application that ends at the browser needs one plugin system. An application
with a server needs two — and the moment it has two, every question it answers
has two answers unless the two agree on what a plugin *is*.

Reactor's answer is to declare the same constructs on both sides, with the
same names and the same presentation fields, so that:

- a plugin list can show frontend and backend plugins in one list, in one shape;
- a plugin can declare what it needs from the other tier *before* either side
  has loaded;
- a graph can be drawn across the wire, because both halves describe themselves
  the same way.

See [Architecture](/overview/architecture) for the constructs, and
[Cross-tier Dependencies](/cross-tier-dependencies) for what a plugin may say
about its counterpart.

## What is deliberately not here

- **An application's enablement rules.** Whether a view *may* be opened right
  now — a notebook that needs a running kernel — is a question about your
  domain, not about the platform. Reactor stores records and hands them back.
- **A router, a store, or a UI kit.** The React bindings render what plugins
  contribute; they do not decide what your application looks like.
- **Enforcement across the wire.** Backend `dependencies` are checked at
  registration and refused outright. A frontend dependency cannot be — the
  plugins live in a browser the platform cannot see. Reactor declares those and
  [answers questions about them](/cross-tier-dependencies) instead of
  pretending to enforce them.
