---
sidebar_position: 8
title: Python-Packaged Extensions
---

# Packaging and loading a frontend + backend extension as a Python package

Tracked as [datalayer/reactor#12](https://github.com/datalayer/reactor/issues/12), the server half of [Federation](/federation). This page keeps the design record: the problem, what the model already gave it, and what was built.

## Status: shipped

:::tip Shipped
A distribution can ship both halves, a server discovers it by installing it, and
**installing one while the server runs makes it appear on the next browser
refresh**. See [Packaging an extension](/python-plugins/packaging).

The two open items have landed: a frontend half can be a **Module Federation
container** (`kind="federated"`, built by Rsbuild straight into `share/`, loaded
by the browser through the federation loader), and
[`examples/extension-template`](https://github.com/datalayer/reactor/tree/main/examples/extension-template)
scaffolds one for people outside this repository. Version coupling is now
mechanical — the container is built into the wheel — and an editable install
keeps working with the frontend served from a dev server and hot-updated by name.
See [Shipping a container](/python-plugins/packaging#shipping-a-container).
:::

## The problem

An [extension](/typescript-plugins/extensions) is the unit of delivery — *"what would I
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
  [#9](/federation): the server can list what is installed, but a browser
  can only *load* it if the shell can consume a remote. The two features are
  worth building in that order.
- **Version coupling.** The two halves ship together, so they can be required to
  match — which is a stronger guarantee than
  [`frontend_requirements`](/cross-tier-dependencies) can offer today,
  and worth making explicit rather than assumed.
- **Development ergonomics.** An editable install has to keep working: a plugin
  author must be able to edit the TSX and see it without rebuilding a wheel.
