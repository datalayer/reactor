[![Datalayer](https://images.datalayer.io/legacy/datalayer-25.svg)](https://datalayer.ai)

# ⚛️ Extension template — start one outside this repository

A Reactor extension is one Python package that carries two things: a plugin
that runs in the server, and the JavaScript that runs in the browser. Installing
the package with `pip` is the whole installation — a Reactor host discovers it,
serves its JavaScript, and the browser shows it on the next refresh, with no
restart.

This directory is that package with the names left blank, and a script that
fills them in. This page walks through it from nothing.

## What you need

| Tool | Version | Why |
| --- | --- | --- |
| Python | 3.10 or newer | the server half, and `pip` to install the package |
| Node.js and npm | Node 20 or newer | to build the browser half once, before packaging |
| A copy of `new-extension.py` and `template/` | — | clone this repository, or download this directory |

The generated package depends on `datalayer_reactor` 1.4.0 or newer (on PyPI)
and its frontend on `@datalayer/reactor` 1.4.0 or newer (on npm). You install
neither by hand: `pip` and `npm` fetch them.

## 1. Make one

Pick a name: lowercase, with dashes, such as `acme-charts`. Then:

```bash
python examples/extension-template/new-extension.py acme-charts ~/src/acme-charts
```

The script copies `template/` into `~/src/acme-charts` and replaces three
placeholders, in file names and file contents:

| Placeholder | For `acme-charts` | What it names |
| --- | --- | --- |
| `__NAME__` | `acme-charts` | the extension, its entry point, its Python plugin, its `share/` directory |
| `__PACKAGE__` | `acme_charts` | the Python package, and the Module Federation container |
| `__PLUGIN__` | `@acme/charts` | the frontend plugin (pass `--plugin @you/name` to choose it) |

Nothing else is generated. What comes out is a plain project you own, with the
comments left in.

## 2. What is in it

```
acme-charts/
  pyproject.toml              the package: its name, its entry point, what goes in the wheel
  .gitignore                  the frontend's node_modules and the built share/ directory
  acme_charts/
    __init__.py               extension(): declares both halves, and is the entry point
    _version.py               the version, read back from the installed package
    plugin.py                 the Python half: a plugin with one route
  frontend/
    package.json              the frontend, and THE version of the whole extension
    rsbuild.config.ts         builds the container into ../share/
    src/plugin.tsx            the browser half: a plugin with one sidebar panel
    tsconfig.json
```

and, after the frontend is built (step 3):

```
  share/datalayer/reactor/extensions/acme-charts/
    remoteEntry.js            the container the browser loads
    package.json              a copy of frontend/package.json: the version it was built at
    static/…                  the container's chunks
```

How the pieces find each other:

- **`pyproject.toml` publishes the extension.** Its entry point,
  `[project.entry-points."datalayer.reactor.extensions"]`, is what a Reactor host
  scans. Installing the package is publishing it; no host names it anywhere.
- **The entry point is `acme_charts:extension`**, a function returning one
  `ReactorExtension`: the Python plugin (from `plugin.py`) and a
  `FrontendExtension` describing the JavaScript — where it is, and the
  *manifest* of each frontend plugin. The manifest is written in Python so a
  host can list and describe the plugin before any JavaScript is fetched.
- **The names are written twice, once per language, and must agree:**

  | In `acme_charts/__init__.py` | In `frontend/` |
  | --- | --- |
  | `remote_name="acme_charts"` | `name: 'acme_charts'` in `rsbuild.config.ts` |
  | `entry="remoteEntry.js"` | `filename: 'remoteEntry.js'` in `rsbuild.config.ts` |
  | `module="./plugin"` | the key of `exposes` in `rsbuild.config.ts` |
  | `FrontendPlugin(name="@acme/charts")` | `name: '@acme/charts'` in `src/plugin.tsx` |

  Rename one side and not the other and the browser cannot load the plugin;
  the host says why on the plugin's manifest (`loadError`).
- **One version, written once**, in `frontend/package.json`. `pyproject.toml`
  reads it from there when the wheel is built (`hatch-nodejs-version`),
  `_version.py` reads it back from the installed package, and the frontend
  build copies `package.json` beside what it emitted. The host compares the two:
  a frontend built at another version than the Python half is refused (see
  [When the versions disagree](#when-the-versions-disagree)).
- **`required_backend_plugins=["acme-charts"]`** ties the panel to the Python
  plugin: the panel only renders while the Python half is enabled.

## 3. Build the frontend

```bash
cd ~/src/acme-charts/frontend
npm install
npm run build
```

This writes the container into `../share/datalayer/reactor/extensions/acme-charts/`
(emptied first). Build it before every `pip install` that should carry a
frontend change — the wheel packs whatever is in `share/` at that moment.

## 4. Install it

```bash
cd ~/src/acme-charts
pip install .
```

into the same Python environment as the host that should run it. One wheel,
both halves: the Python package, and the built frontend as data under
`<prefix>/share/datalayer/reactor/extensions/acme-charts/`.

Check that the environment advertises it — this is exactly what a host scans:

```bash
python -c "from importlib.metadata import entry_points; print(entry_points(group='datalayer.reactor.extensions').names)"
# {'acme-charts', …}
```

## 5. Run it in a host

Any Reactor host discovers it. The smallest is the one `datalayer_reactor`
installs, which serves the API and no interface of its own:

```bash
reactor serve --port 8787
```

and, from another terminal:

```bash
curl -s localhost:8787/plugins/frontend-extensions
```

The `acme-charts` record lists the frontend plugin `@acme/charts`, the container
(`kind: federated`, `remoteName: acme_charts`, `module: ./plugin`) and its entry
URL, with no `refused` field; `curl -s localhost:8787/plugins` lists the Python
plugin `acme-charts`, enabled. Its route in `plugin.py` is a *descriptor* — a
host lists it (`GET /tenants/{tenant}/routes`) and decides whether to mount it;
give it an `endpoint` to have `include_plugin_routes` mount it for you.

To *see* the panel you need a host with an interface: one whose page calls
`bootstrapExtensions(backendUrl)` and renders the `sidebar` slot. The music store
in this repository is one ([`examples/music`](../music/)):

```bash
uvicorn datalayer_music_example.app:app --port 8799   # already running
pip install ~/src/acme-charts                          # while it runs
# refresh the browser: the acme-charts panel is in the sidebar,
# and the acme-charts Python plugin is in the plugin list
```

A host page that loads Module Federation containers must hand Reactor its copy
of the federation runtime once, before `bootstrapExtensions` — Reactor does not
bundle it:

```ts
import * as FederationRuntime from '@module-federation/runtime';
setFederationRuntime(FederationRuntime as unknown as ReactorFederationRuntime);
```

Without it, the plugin stays listed with a `loadError` saying it needs
`@module-federation/runtime`.

## 6. Change it

| To change | Edit | Then |
| --- | --- | --- |
| what the panel draws | `frontend/src/plugin.tsx` | `npm run build`, `pip install .`, refresh |
| what the server does | `acme_charts/plugin.py` | `pip install .`, restart the host |
| the name, icon or description a host shows | `acme_charts/__init__.py` | `pip install .`, restart the host |
| the version | `frontend/package.json`, only | `npm run build`, `pip install .` |

A Python module, once imported, stays imported in a running process, so a change
to the Python half needs the host restarted; a frontend change needs only a
refresh.

### Without rebuilding the wheel each time

```bash
pip install -e .                 # the Python half, editable
(cd frontend && npm run dev)     # the container on http://localhost:5183, hot updates
```

then, once, from the host page's console:

```ts
setAllowedOrigins(['http://localhost:5183']);
updateFederatedRemote('acme_charts', 'http://localhost:5183/remoteEntry.js');
```

Edits to `frontend/src/plugin.tsx` then arrive without a build or a restart.
The first line is required: a dev server on another port is another origin, and
a host only loads code from origins it was told about.

## When the versions disagree

Bump `frontend/package.json` to `0.2.0`, run `pip install .` and forget
`npm run build`, and the wheel carries a Python half at 0.2.0 and a frontend
built at 0.1.0. The host refuses that frontend rather than loading it:

- its log says, once, at `ERROR`:
  `Frontend refused: acme-charts: its frontend was built at 0.1.0 and its Python half is 0.2.0. Both ship in one wheel, so this is a packaging bug: rebuild the frontend, then reinstall the package.`
- `GET /plugins/frontend-extensions` carries the same sentence as `refused`;
- the browser lists `@acme/charts`, never fetches it, and shows that sentence
  as its `loadError`.

The Python plugin keeps running. `npm run build` then `pip install .` fixes it.
A frontend that was never built is refused the same way, for recording no
version.

## Publishing it

`pip wheel . -w dist` (or `python -m build`) after `npm run build` produces the
wheel that carries both halves; publish it as any Python package. Nothing goes
to npm: the frontend travels inside the wheel.

## This template is tested

`tests/test_extension_template.py` generates an extension, checks the names in
the table above agree, builds the wheel with this `pyproject.toml`, installs it
and serves it from a host — and makes the version mismatch above, to check it is
refused. `template.test.ts` runs `frontend/src/plugin.tsx` in the runtime. A
change that breaks a newcomer's first hour fails there first.
