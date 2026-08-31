---
sidebar_position: 2
title: Contribution points
---

# Contribution points in Python

The same model as the TypeScript runtime: a plugin declares what it *offers*, the
host enumerates and chooses.

```python
from reactor import PluginManifest, PluginPlatform, define_contribution_point

VIEW_TYPE = define_contribution_point("app.viewType")


class NotebookPlugin:
    def provide_contributions(self, contributions) -> None:
        contributions.contribute(
            VIEW_TYPE,
            {"title": "Notebook", "route": "/notebook"},
            contribution_id="notebook",
            order=10,
        )


platform = PluginPlatform()
platform.register_plugin(PluginManifest(name="notebook", version="1.0.0"), NotebookPlugin())

for contribution in platform.get_contributions(VIEW_TYPE):
    print(contribution.id, contribution.value["title"])
```

A plugin receives a view bound to its own name, so it contributes *as itself*
rather than passing a name that could be wrong — or borrowed.

## Two differences from the TypeScript side

Both deliberate.

### Tenants

`get_contributions(point, tenant_id=...)` filters by what that tenant may use, so
enablement is applied where it already lives instead of at every call site. See
[Tenants and marketplace](/python/tenants-and-marketplace).

### Disable keeps, unregister disposes

```python
platform.disable_plugin("notebook")
platform.get_contributions(VIEW_TYPE)        # [] — hidden, not lost
platform.enable_plugin("notebook")
platform.get_contributions(VIEW_TYPE)        # back, same objects

platform.unregister_plugin("notebook")       # gone for good
```

The asymmetry is on purpose: the Python platform has no re-register path, so
disposing on disable would make a toggle destructive. Contributions are filtered
on read instead — which is also where tenant scoping already happens.

## Contributing after registration

Through the same bound view:

```python
dispose = platform.contributions_for("notebook").contribute(
    VIEW_TYPE, {"title": "Scratch"}, contribution_id="scratch"
)
dispose()   # idempotent
```
