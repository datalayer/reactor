[![Datalayer](https://assets.datalayer.tech/datalayer-25.svg)](https://datalayer.io)

[![Become a Sponsor](https://img.shields.io/static/v1?label=Become%20a%20Sponsor&message=%E2%9D%A4&logo=GitHub&style=flat&color=1ABC9C)](https://github.com/sponsors/datalayer)

# ☢️ Reactor

Reactor provides two sibling packages:

- `datalayer_reactor` (PyPI distribution, imported as `reactor`): FastAPI + pluggy plugin reactor for modular extensibility.
- `@datalayer/reactor` (TypeScript): Extension runtime with a framework-agnostic core and separate React integration.

## Why Reactor

This project targets a full extension reactor, not only hook callbacks:

- Platform architecture with lifecycle phases and dependency graph
- Plugin marketplace metadata and discovery primitives
- Third-party ecosystem support through explicit manifest contracts
- Dynamic feature loading and runtime enable/disable
- Modular app concerns: interdependencies, lifecycle management, compatibility checks
- SaaS extensibility primitives: tenant-specific plugin activation, sandboxed execution, versioned compatibility

## Repository Layout

- `src/`: TypeScript package source for `@datalayer/reactor`
- `reactor/`: Python package source
- `examples/`: Various demos

## TypeScript Package: @datalayer/reactor

### Design

The TypeScript runtime implements:

- `defineExtension` and `configExtension`
- `dependencies`, `peerDependencies`, `conflictsWith`
- ordered phases: `init` -> `build` -> `register` -> `afterRegistration`
- runtime lifecycle control: `start`, `stop`, `enable`, `disable`
- extension points and contributions: `defineExtensionPoint`, `contribution`,
	`ctx.contribute`, `reactor.getContributions`
- signal primitives for reactive extension outputs:
	- `signal`, `computed`, `effect`, `batch`, `untracked`
	- `namedSignals`, `watchedSignal`

### Core vs React split

- Core runtime exports from `@datalayer/reactor`
- React bindings export from `@datalayer/reactor/react`

React bindings include:

- `useReactor`: register the reactor in the zustand store and manage its lifecycle
- `ReactorSlot`: render plugin-provided components by named slot
- `useReactorPlatform`: reactor access for runtime toggles
- `useContributions`: subscribe to an extension point
- `ReactorViewHost`: render the one contribution the application chose
- `ReactorLazy`: a lazily-loaded component with Suspense and an error boundary

### Slots or extension points?

Both let a plugin add something. They answer different questions.

**A slot** answers "render everything plugins put here" — a header, a toolbar, a
status bar. Every contribution is rendered, the application does not choose, and
the plugin supplies a component.

**An extension point** answers "what do plugins *offer*, so the application can
choose?" — a set of views of which one is on screen, commands of which one is
invoked, mention namespaces resolved on demand. Contributions are typed records
rather than components, the application enumerates them and decides, and a record
can carry anything: a title, an icon, an ordering, a lazy module.

Reach for a slot when everything contributed should appear. Reach for an
extension point when something has to pick.

```ts
import { defineExtensionPoint, contribution, defineExtension } from '@datalayer/reactor';

type ViewType = {
	title: string;
	load: () => Promise<{ default: React.ComponentType }>;
};

export const ViewTypePoint = defineExtensionPoint<ViewType>('app.viewType');

export const NotebookExtension = defineExtension({
	name: '@app/notebook',
	// Declarative: resolved during the register phase.
	contributes: [
		contribution(
			ViewTypePoint,
			{ title: 'Notebook', load: () => import('./NotebookView') },
			{ id: 'notebook', order: 10 },
		),
	],
	// Imperative: for contributions that depend on build output, or that appear
	// later. Returns a disposer.
	register(ctx) {
		if (ctx.reactor.hasExtension('@app/sandbox')) {
			ctx.contribute(ViewTypePoint, { title: 'Sandbox', load: () => import('./SandboxView') }, { id: 'sandbox' });
		}
	},
});
```

```tsx
import { ReactorViewHost } from '@datalayer/reactor/react';

<ReactorViewHost
	point={ViewTypePoint}
	active={activeViewType}
	props={{ workspace }}
	fallback={<Spinner />}
	empty={<EmptyState />}
/>;
```

Contributions are ordered by `order` and then by contribution order, and they are
disposed with the extension that made them: disabling a plugin removes its views
from the switcher without the application tracking anything.

Enablement rules stay in the application. The reactor stores records and hands
them back; whether a view *may* be opened right now — a notebook that needs a
running kernel — is a question about your domain, not about the platform.

### Turning plugins on and off at runtime

`enable` and `disable` are not restart-only switches. Disabling an extension
disposes everything it contributed, and any host reading through
`useContributions` or `ReactorSlot` updates immediately — a view leaves the
switcher, a command leaves the palette, without the application tracking
anything.

```ts
reactor.disable('@app/notebook');
reactor.getContributions(ViewTypePoint); // the notebook view is gone
reactor.enable('@app/notebook');
reactor.getContributions(ViewTypePoint); // and back
```

This is what makes a plugin checkbox honest: the list of extensions comes from
`reactor.listExtensions()`, the state from `reactor.isEnabled(name)`, and the UI
that follows is one `useSyncExternalStore` away.

```tsx
function PluginToggles() {
	const reactor = useReactorPlatform();
	useSyncExternalStore(reactor.subscribe, reactor.getRevision);

	return (
		<ul>
			{reactor.listExtensions().map(name => (
				<li key={name}>
					<label>
						<input
							type="checkbox"
							checked={reactor.isEnabled(name)}
							onChange={event =>
								event.target.checked ? reactor.enable(name) : reactor.disable(name)
							}
						/>
						{name}
					</label>
				</li>
			))}
		</ul>
	);
}
```

**One thing to know before you rely on it.** `enable()` re-runs `init` and
`build`, so an extension that *owns state* — a connection, a cache, a service
object — comes back as a **fresh instance**. Anything that captured the previous
build output is now holding a detached one. Two ways to be safe:

- make `build` idempotent for stateful extensions (return the same service from
	a module-level or closure-held singleton), or
- have consumers read the service through `reactor.getOutput(name)` at the point
	of use rather than capturing it once.

A stateless extension — one that only contributes records and components — can
be toggled freely with nothing to think about.

### Disposal, in one place

| What happens | What the reactor does |
| --- | --- |
| `disable(name)` | runs the extension's `register` / `afterRegistration` disposers, then drops every contribution it made |
| `enable(name)` | re-runs `init`, `build`, `register` — a fresh build output |
| `stop()` | disposes every extension in reverse dependency order |
| a disposer returned by `ctx.contribute(...)` | removes that one contribution; idempotent |

Every one of these bumps the revision exactly once, so a plugin contributing
five views during `register` wakes subscribers once rather than five times.

### Build

```bash
npm install
npm run build
```

### Minimal TypeScript usage

```ts
import { buildReactorFromExtensions, defineExtension } from '@datalayer/reactor';

const DemoExtension = defineExtension({
	name: '@demo/core',
	build() {
		return { message: 'hello' };
	},
});

const reactor = buildReactorFromExtensions([DemoExtension]);
reactor.start();
```

## Python Package: datalayer_reactor

### Capabilities

- Pluggy-powered plugin registration (`register_plugin`) and removal (`unregister_plugin`)
- Extension points and contributions: `define_extension_point`,
	`provide_contributions`, `platform.get_contributions(point)` — the same model
	as the TypeScript runtime, with tenant scoping applied on read
- Host extension hooks: `provide_cli` (command-line applications) and
	`provide_slash_commands` (interactive sessions — a terminal, a prompt, a
	command palette)
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
python -m reactor
```

### API app endpoints

- `GET /plugins`
- `POST /plugins/{plugin_name}/toggle`
- `POST /tenants/plugins/{plugin_name}/toggle`
- `GET /tenants/{tenant_id}/features`
- `GET /tenants/{tenant_id}/routes`
- `GET /marketplace`

### Extension points in Python

The same model as the TypeScript runtime: a plugin declares what it *offers*,
the host enumerates and chooses.

```python
from reactor import PluginManifest, PluginPlatform, define_extension_point

VIEW_TYPE = define_extension_point("app.viewType")


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

Two differences from the TypeScript side, both deliberate:

- **Tenants.** `get_contributions(point, tenant_id=...)` filters by what that
	tenant may use, so enablement is applied where it already lives instead of at
	every call site.
- **Disable keeps, unregister disposes.** Disabling a plugin is reversible and
	its contributions are retained (hidden, then restored on enable);
	unregistering is not, and takes them with it.

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

A plugin can contribute after registration too, through the same bound view:

```python
dispose = platform.contributions_for("notebook").contribute(
		VIEW_TYPE, {"title": "Scratch"}, contribution_id="scratch"
)
dispose()   # idempotent
```

### Minimal Python usage

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
