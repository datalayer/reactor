---
sidebar_position: 0
title: What it implements
---

# The Python runtime

The distribution is `datalayer_reactor`; the import name is `reactor`.

- Pluggy-powered plugin registration (`register_plugin`) and removal
  (`unregister_plugin`)
- Contribution points and contributions: `define_contribution_point`,
  `provide_contributions`, `platform.get_contributions(point)` — the same model
  as the TypeScript runtime, with tenant scoping applied on read
- Host extensibility hooks: `provide_cli` (command-line applications) and
  `provide_slash_commands` (interactive sessions — a terminal, a prompt, a
  command palette)
- Compatibility and dependency checks via `PluginManifest`
- Presentation metadata — `display_name`, `description`, `octicon`, `emoji` —
  the same four fields the TypeScript tier declares, so one host can list both
  without special-casing either
- Declared frontend dependencies (`frontend_dependencies`,
  `optional_frontend_dependencies`) answered by
  `platform.frontend_requirements(active)`
- Runtime enable/disable globally and by tenant
- Marketplace publication and listing (`PluginMarketplace`)
- Sandboxed execution option for plugin calls
- A FastAPI control plane with plugin and tenant endpoints

## Two differences from the TypeScript tier

Both are deliberate, and both come from the same fact — there is no module on
the wire:

1. **Activation is synchronous.** The plugins a read wakes are in the list that
   read returns. Deferral is *construction*, not fetching: register a `factory`
   instead of an implementation.
2. **Disable keeps, unregister disposes.** Disabling is reversible and
   contributions are retained (hidden, then restored on enable); unregistering is
   not, and takes them with it. See
   [Contribution points](/python/contribution-points).
