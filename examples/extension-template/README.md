[![Datalayer](https://assets.datalayer.tech/datalayer-25.svg)](https://datalayer.io)

# ⚛️ Extension template — start one outside this repository

Everything a Reactor extension needs, with the names left blank:

```
template/
  pyproject.toml                       # the wheel: entry point + share/ data
  __PACKAGE__/__init__.py              # the entry point callable
  __PACKAGE__/plugin.py                # the Python plugin
  frontend/                            # Rsbuild project building the container
    rsbuild.config.ts                  #   … straight into share/
    src/plugin.tsx                     #   the frontend plugin, as source
  share/datalayer/reactor/extensions/__NAME__/
                                       # where the built container lands
```

## Make one

```bash
python examples/extension-template/new-extension.py acme-charts ~/src/acme-charts
cd ~/src/acme-charts
(cd frontend && npm install && npm run build)   # the container, into share/
pip install .                                    # both halves, one wheel
```

The script copies `template/` and substitutes three names:

| Placeholder | Example | Used for |
| --- | --- | --- |
| `__NAME__` | `acme-charts` | the extension, the entry point, the `share/` directory |
| `__PACKAGE__` | `acme_charts` | the Python package and the Module Federation container name |
| `__PLUGIN__` | `@acme/charts` | the frontend plugin's name |

Nothing else is generated: the result is a plain directory you own, with the
comments left in so the next person can read why each line is there.

## Develop it

```bash
pip install -e .                 # the Python half, editable
(cd frontend && npm run dev)     # the container on :5183, hot updates
```

and from the host's console, once:

```ts
updateFederatedRemote('__PACKAGE__', 'http://localhost:5183/remoteEntry.js');
```

Edits to `frontend/src/plugin.tsx` then arrive without rebuilding the wheel.
