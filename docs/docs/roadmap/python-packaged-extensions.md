---
sidebar_position: 3
title: Frontend + backend extensions as one Python package
---

# Packaging and loading a frontend + backend extension as a Python package

**Tracking: [datalayer/reactor#12](https://github.com/datalayer/reactor/issues/12)**
· related to [#9](/roadmap/federation)

## The problem

An [extension](/typescript/extensions) is the unit of delivery — *"what would I
uninstall to lose this?"*. In an application with two tiers, the honest answer to
that question usually spans both: the checkout view and the endpoint that prices
a cart are one capability, and nobody wants to install them separately or
discover they are at different versions.

Today they are two installs. In the [music example](/examples/music/) that is
five `pip install -e` lines *and* an `npm install`, and the two halves are kept
in step by hand.

## What already points the right way

- **The Python tier already discovers plugins from distributions.**
  `platform.discover(group)` registers whatever is advertised under an
  entry-point group, so installing a distribution publishes its plugins and
  nothing is hardcoded in the host. That is precisely the mechanism a packaged
  extension would extend.
- **The manifest already spans the wire.** A Python `PluginManifest` already
  declares `frontend_dependencies` and the same four presentation fields as its
  TypeScript counterpart. A distribution that carried both halves would not need
  a new vocabulary — it would need somewhere to put the built JavaScript.
- **Jupyter already proves the pattern.** A JupyterLab extension is a Python
  distribution with a labextension shipped inside it; that is the shape being
  aimed at here.

## What has to be designed

- **Where the frontend build lives in the wheel**, and what advertises it — an
  entry-point group, a `[project.entry-points]` table, or a data directory the
  host scans.
- **How the shell finds it at runtime.** This is where the issue meets
  [#9](/roadmap/federation): the server can list what is installed, but a browser
  can only *load* it if the shell can consume a remote. The two features are
  worth building in that order.
- **Version coupling.** The two halves ship together, so they can be required to
  match — which is a stronger guarantee than
  [`frontend_requirements`](/cross-tier/declaring-dependencies) can offer today,
  and worth making explicit rather than assumed.
- **Development ergonomics.** An editable install has to keep working: a plugin
  author must be able to edit the TSX and see it without rebuilding a wheel.
