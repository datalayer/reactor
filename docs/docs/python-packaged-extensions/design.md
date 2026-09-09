---
sidebar_position: 2
title: Why it is Shaped This Way
---

# Why it is shaped this way

## The problem

An [extension](/typescript-plugins/extensions) is the unit of delivery — *"what would I
uninstall to lose this?"*. In an application with two tiers, the honest answer to
that question usually spans both: the checkout view and the endpoint that prices
a cart are one capability, and nobody wants to install them separately or
discover they are at different versions.

Today they are two installs. In the [music example](/examples/music/) that is
five `pip install -e` lines *and* an `npm install`, and the two halves are kept
in step by hand.

## What already pointed the right way

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

## How the open questions were answered

- **Where the frontend build lives in the wheel** — under
  `share/datalayer/reactor/extensions/<name>/`, declared as `shared-data`; the
  entry-point group `datalayer.reactor.extensions` advertises it.
- **How the shell finds it at runtime** — `GET /plugins/frontend-extensions`
  lists it with its manifests, `GET /reactor-extensions/{name}/{path}` serves
  it, and the browser loads it through the same seam as any
  [remote plugin](/typescript-plugins/federation) — as a plain module or as a
  Module Federation container.
- **Version coupling** — the container is built straight into `share/`, so
  the two halves cannot ship at different versions.
- **Development ergonomics** — the Python half stays `pip install -e`; the
  frontend runs on a dev server and is hot-updated into the running host by
  name.
