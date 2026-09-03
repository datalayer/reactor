---
sidebar_position: 4
title: Extensions
---

# Extensions

A capability is rarely one plugin. A notebook is an editor, a toolbar, a set of
commands — and nobody wants to install four things to get one, or to read a
plugin list where those four sit at the same level as everything else.

```ts
export const NotebookExtension = defineExtension({
  name: '@app/notebooks',
  displayName: 'Notebooks',
  description: 'The editor, its toolbar, and the commands that drive them.',
  emoji: '📓',
  plugins: [NotebookEditorPlugin, NotebookToolbarPlugin, NotebookCommandsPlugin],
});

const reactor = buildReactorFromPlugins([NotebookExtension, ShellPlugin]);
```

## Deliberately thin

| It has | It does not have |
| --- | --- |
| a name and version | a lifecycle, phases, or config |
| presentation (`displayName`, `description`, `octicon`, `emoji`) | contributions of its own |
| the plugins it delivers | an enabled/disabled state |

Registering one registers its plugins and records the grouping on each manifest.
From that moment the platform deals only in plugins:

```ts
reactor.listPlugins();                       // ['@app/notebook-editor', …]
reactor.hasPlugin('@app/notebooks');         // false — it is not a plugin
reactor.getManifest('@app/notebook-editor'); // { extension: '@app/notebooks', … }
reactor.listExtensions();                    // ['@app/notebooks']
reactor.getExtensionManifest('@app/notebooks');
// { displayName: 'Notebooks', plugins: ['@app/notebook-editor', …] }
```

Each member is still switched off on its own — grouping is about delivery, not
governance. A plugin that merely arrived as a *dependency* of a member is not
grouped: a package should not claim to deliver what it only relies on.

## In React, and on the graph

`useGroupedPluginManifests()` returns the same list arranged by extension, with
ungrouped plugins in one bucket at the end.

The [graph plugin](/core-plugins/graph) draws extensions in a column of their own,
joined to each plugin they delivered by a `groups` edge — so *"what would I
uninstall to lose this view?"* is answerable by following arrows.
