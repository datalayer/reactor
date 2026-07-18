[![Datalayer](https://assets.datalayer.tech/datalayer-25.svg)](https://datalayer.io)

# ⚛️ 🚀 Reactor

Reactor provides two sibling packages in one repository, with no python/typescript subpackage folders:

- `datalayer_reactor` (Python): FastAPI + pluggy plugin platform for modular and SaaS-style extensibility.
- `@datalayer/reactor` (TypeScript): Extension runtime with a framework-agnostic core and separate React integration.

## Why Reactor

This project targets a full extension platform, not only hook callbacks:

- Platform architecture with lifecycle phases and dependency graph
- Plugin marketplace metadata and discovery primitives
- Third-party ecosystem support through explicit manifest contracts
- Dynamic feature loading and runtime enable/disable
- Modular app concerns: interdependencies, lifecycle management, compatibility checks
- SaaS extensibility primitives: tenant-specific plugin activation, sandboxed execution, versioned compatibility

## Repository Layout

- `src/`: TypeScript package source for `@datalayer/reactor`
- `datalayer_reactor/`: Python package source
- `examples/frontend/`: frontend-only React + Primer UI demo
- `examples/frontend-backend/`: combined React + Python demo

## TypeScript Package: @datalayer/reactor

### Design

The TypeScript runtime implements:

- `defineExtension` and `configExtension`
- `dependencies`, `peerDependencies`, `conflictsWith`
- ordered phases: `init` -> `build` -> `register` -> `afterRegistration`
- runtime lifecycle control: `start`, `stop`, `enable`, `disable`
- signal primitives for reactive extension outputs:
	- `signal`, `computed`, `effect`, `batch`, `untracked`
	- `namedSignals`, `watchedSignal`

### Core vs React split

- Core runtime exports from `@datalayer/reactor`
- React bindings export from `@datalayer/reactor/react`

React bindings include:

- `ReactorProvider`: platform lifecycle in React tree
- `ReactorSlot`: render plugin-provided components by named slot
- `useReactorPlatform`: platform access for runtime toggles

### Build

```bash
npm install
npm run build
```

### Minimal TypeScript usage

```ts
import { buildPlatformFromExtensions, defineExtension } from '@datalayer/reactor';

const DemoExtension = defineExtension({
	name: '@demo/core',
	build() {
		return { message: 'hello' };
	},
});

const platform = buildPlatformFromExtensions([DemoExtension]);
platform.start();
```

## Python Package: datalayer_reactor

### Capabilities

- Pluggy-powered plugin registration (`register_plugin`)
- Compatibility and dependency checks via `PluginManifest`
- Runtime enable/disable globally and by tenant
- Marketplace publication/listing (`PluginMarketplace`)
- Sandboxed execution option for plugin calls
- FastAPI control plane with plugin/tenant endpoints

### Install and run

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
python -m datalayer_reactor
```

### API app endpoints

- `GET /plugins`
- `POST /plugins/{plugin_name}/toggle`
- `POST /tenants/plugins/{plugin_name}/toggle`
- `GET /tenants/{tenant_id}/features`
- `GET /tenants/{tenant_id}/routes`
- `GET /marketplace`

### Minimal Python usage

```python
from datalayer_reactor import PluginManifest, PluginCompatibility, PluginPlatform

platform = PluginPlatform()
platform.register_plugin(
		PluginManifest(
				name="greeting-plugin",
				version="1.0.0",
				compatibility=PluginCompatibility(api_version="v1"),
		),
		plugin_impl=object(),
)
```

## Next Steps

- Add semantic version range support (`^`, `~`) for compatibility contracts
- Add a persisted marketplace backend (database + signed plugin artifacts)
- Add stronger sandbox isolation (subprocess/container boundaries)
- Add plugin state migrations for compatibility layer upgrades
