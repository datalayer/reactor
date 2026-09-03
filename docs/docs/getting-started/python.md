---
sidebar_position: 2
title: Python
---

# Getting started in Python

The distribution is `datalayer_reactor` on PyPI; the import name is `reactor`.

## Install and run

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
python -m reactor
```

## A plugin, a platform, a registration

```python
from reactor import PluginManifest, PluginCompatibility, PluginPlatform

reactor = PluginPlatform()
reactor.register_plugin(
    PluginManifest(
        name="greeting-plugin",
        version="1.0.0",
        compatibility=PluginCompatibility(api_version="v1"),
    ),
    plugin_impl=object(),
)
```

## Serving it

`create_reactor_app(platform)` returns a FastAPI application with the reactor's
own management API mounted on it — the plugin list, the toggles, the events.
Your plugins' routers go on top:

```python
from fastapi import FastAPI
from reactor import PluginPlatform, create_reactor_app

def create_app() -> FastAPI:
    platform = PluginPlatform()
    register_catalog(platform)
    platform.start()

    app = create_reactor_app(platform)
    app.include_router(catalog_router)
    return app
```

```bash
uvicorn my_backend.app:app --reload --port 8799
```

See [the HTTP API](/python-plugins/http-api) for what `create_reactor_app` serves, and
[the music example's backend](/examples/music/backend) for a host composing four
plugin packages on one platform.

## Where to go next

| You want to | Read |
| --- | --- |
| write a manifest with everything on it | [Plugins](/python-plugins/plugins) |
| let plugins offer things the host chooses between | [Contribution points](/python-plugins/contribution-points) |
| group plugins, and defer their construction | [Extensions and events](/python-plugins/extensions-and-events) |
| scope plugins per tenant, or publish them | [Tenants and marketplace](/python-plugins/tenants-and-marketplace) |
| tell the frontend what you need from it | [Cross-tier Dependencies](/cross-tier-dependencies) |
