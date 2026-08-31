---
sidebar_position: 4
title: Tenants and marketplace
---

# Tenants, sandboxing and the marketplace

These are the SaaS extensibility primitives, and they exist only on the Python
tier — which is where a multi-tenant application's authority actually lives.

## Tenants

A tenant is a scope for enablement. Global state says what the deployment runs;
tenant state says what one customer may use.

```python
platform.enable_plugin("checkout")                       # globally
platform.enable_plugin("checkout", tenant_id="acme")     # for one tenant
platform.get_contributions(VIEW_TYPE, tenant_id="acme")  # filtered on read
```

Applying the scope on read is the point: enablement is checked where the data is
already being looked up, rather than at every call site that might have
forgotten.

The HTTP surface mirrors it:

- `POST /tenants/plugins/{plugin_name}/toggle`
- `GET /tenants/{tenant_id}/features`
- `GET /tenants/{tenant_id}/routes`

## Sandboxed execution

Plugin calls can be invoked through a sandbox, so a third-party plugin's failure
is a failure of that call rather than of the host.

## Marketplace

`PluginMarketplace` is the publication and listing primitive — the metadata half
of a third-party ecosystem, served at `GET /marketplace`. It is deliberately
separate from the platform: what is *installable* and what is *installed* are
different questions, and a platform that conflated them could not show a plugin
before it was installed.
