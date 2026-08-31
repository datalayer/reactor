---
sidebar_position: 0
title: Bundled plugins
slug: /plugins/
---

# Bundled plugins

`plugins/` in the repository holds plugins that are reusable across
applications: they know about *a reactor*, and nothing about your domain. They
are installed like any other plugin, and switched off like any other plugin.

| Package | What it contributes |
| --- | --- |
| [`@datalayer/reactor-manager`](/plugins/manager) | the plugin list, and a switch per plugin |
| [`@datalayer/reactor-graph`](/plugins/graph) | the platform drawn as a graph — extensions, dependencies, points and contributors |

Both are built by `npm run build` at the repository root, alongside the runtime.

The distinction worth keeping: these are not features of the runtime. A plugin
manager that shipped inside `@datalayer/reactor` would be a manager you could
not switch off, and a graph you could not leave out of your bundle.
