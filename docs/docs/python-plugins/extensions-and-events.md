---
sidebar_position: 3
title: Extensions and Events
---

# Extensions and events in Python

The same two constructs, the same vocabulary.

## Grouping plugins

```python
from reactor import ExtensionManifest, PluginManifest, PluginPlatform, on_command

platform = PluginPlatform()

platform.register_extension(
    ExtensionManifest(name="notebooks", display_name="Notebooks", emoji="📓"),
    [
        (PluginManifest(name="editor", version="1.0.0"), EditorPlugin()),
        (PluginManifest(name="toolbar", version="1.0.0"), ToolbarPlugin()),
    ],
)

platform.list_extensions()
# [{"name": "notebooks", "display_name": "Notebooks", "plugins": ["editor", "toolbar"], …}]
```

`GET /extensions` serves the grouping.

## Waiting, and factories

A plugin that waits registers a **factory** rather than an implementation, so the
object is not built until its event fires:

```python
platform.register_plugin(
    PluginManifest(name="reports", version="1.0.0", activation_events=[on_command("report")]),
    factory=lambda: ReportsPlugin(),      # not called yet
)

platform.get_contributions(REPORT_POINT)   # []
platform.fire_event(on_command("report"))  # {"activated": ["reports"], …}
platform.get_contributions(REPORT_POINT)   # the report contributions
```

Reading a contribution point fires `onContributionPoint:<id>` here too. Unlike
the TypeScript tier there is no module on the wire, so activation is synchronous
and the plugins a read wakes are in the list that read returns.

## Standing down

The mirror of waking, and distinct from disabling:

```python
platform.register_plugin(
    PluginManifest(
        name="document-mode",
        version="1.0.0",
        deactivation_events=["onView:notebook"],
    ),
    DocumentModePlugin(),
)

platform.fire_event("onView:notebook")
# {"deactivated": ["document-mode"], "activated": ["notebook-mode"]}

platform.deactivate_plugin("catalog")   # dependants first, transitively
```

A deactivated plugin keeps its manifest, its place in the list and its
implementation, and comes back when one of its activation events fires. A
*disabled* one does not — that is a person's decision, and no event overrides it.
The [three states](/typescript-plugins/deactivation) are the same on both tiers.

`POST /events/{event}` fires an event and answers with what stood down and what
woke; `POST /plugins/{name}/deactivate` stands one down directly.

## Cross-tier activation

A backend plugin going down stands its frontend dependants down, and brings
them back when it returns: `setBackendPlugins()` on the browser side applies
the server's state, and `GET /events/stream` (consumed by
`useBackendPluginStream()`) is what keeps the two in step without polling.
See [Cross-tier Dependencies](/cross-tier-dependencies).
