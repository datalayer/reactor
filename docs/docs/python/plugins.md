---
sidebar_position: 1
title: Plugins
---

# Plugins

## A manifest, in full

```python
PluginManifest(
    name="checkout",                 # the identifier other plugins depend on
    version="1.0.0",
    display_name="Checkout",         # what a person is shown
    description="Prices a cart and turns it into an order.",
    octicon="credit-card",
    emoji="💳",
    dependencies=["catalog"],        # backend: enforced at registration
    frontend_dependencies=["@app/checkout"],          # declared, not enforced
    optional_frontend_dependencies=["@app/header"],
)
```

`manifest.title` returns `display_name` or, failing that, `name` — so a host
always has something to print.

The four presentation fields are the same four the
[TypeScript tier](/typescript/plugins) declares. That is what lets one plugin
list, one overlay and one graph draw a plugin from either side of the wire.

## Registering one

```python
from reactor import PluginManifest, PluginPlatform
from reactor.hooks import hookimpl

class CatalogPlugin:
    @hookimpl
    def on_reactor_start(self, tenant_id: str | None = None) -> None:
        ...

    def provide_routes(self) -> list[dict]:
        return [{"path": "/api/catalog/songs", "method": "GET", "plugin": "catalog"}]

platform = PluginPlatform()
platform.register_plugin(CATALOG_MANIFEST, CatalogPlugin())
platform.start()
```

`dependencies` are **enforced**: the platform refuses a plugin whose declared
dependencies are not registered yet, which is why a host registers in dependency
order. See [the music backend](/examples/music/backend) for a host doing exactly
that with four packages.

## Compatibility

```python
PluginManifest(
    name="catalog",
    version="1.0.0",
    compatibility=PluginCompatibility(api_version="v1"),
)
```

## Discovery

`platform.discover(group)` registers whatever is advertised under an entry-point
group, so installing a distribution publishes its plugins and nothing is
hardcoded in the host. Combined with a `factory`, discovery is lazy in the same
spirit as a lazy plugin in the browser: installed, listed, and not constructed
until wanted.

Packaging a *frontend* extension the same way — one `pip install` delivering
both tiers — is [on the roadmap](/roadmap/python-packaged-extensions).
