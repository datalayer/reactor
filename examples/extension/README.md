[![Datalayer](https://assets.datalayer.tech/datalayer-25.svg)](https://datalayer.io)

# 👋 Hello — one wheel, both tiers

A Reactor extension that ships a Python plugin **and** the UI that uses it, in a
single Python distribution. Installing it publishes both halves; the host names
nothing.

```
examples/extension/
  pyproject.toml                                  # the entry point, and the shared-data rule
  hello_extension/__init__.py                     # what the entry point resolves to
  hello_extension/plugin.py                       # the Python half
  share/datalayer/reactor/extensions/hello/
    index.js                                      # the JavaScript half, in the wheel
```

## Install it into a server that is already running

That is the interesting part, so it is the documented path:

```bash
# a Reactor backend, already serving
uvicorn datalayer_music_example.app:app --reload --port 8799

# in another terminal, while it runs
pip install -e examples/extension

# refresh the browser
```

The panel is there, and so is its Python plugin. Nothing restarted.

**Why that works.** `GET /plugins/frontend-extensions` rescans the entry-point
group before it answers, and `importlib.invalidate_caches()` is what makes a
distribution installed after startup visible at all. The frontend is served by
one route that resolves the directory per request, rather than by a `StaticFiles`
mount — mounts are fixed when the app is built, so an extension discovered later
would have nowhere to be served from. A browser refresh is the entire reload
mechanism.

Check it without a browser:

```bash
curl -s localhost:8799/plugins/frontend-extensions | jq
curl -s localhost:8799/reactor-extensions/hello/index.js
curl -s -X POST localhost:8799/plugins/hello/invoke \
  -H 'content-type: application/json' \
  -d '{"action":"greet","payload":{"name":"Reactor"}}'
```

## Two things worth reading the source for

**The frontend plugin's manifest is declared in Python.** Look at
`FrontendPlugin` in `hello_extension/__init__.py`: name, presentation,
dependencies, `required_backend_plugins`. That is what lets the browser list,
describe and switch this plugin off *before it has fetched a byte of
`index.js`* — the same manifest/entry-point split the runtime already rests on,
now spanning the wire.

**The JavaScript imports nothing.** `index.js` is a plain ES module with no
build step, and it borrows React from `globalThis.__DATALAYER_REACTOR__.shared`
rather than importing it. A module fetched at runtime is not in the host's
bundle, so `import 'react'` there would either fail or — far worse — succeed
and hand this plugin a *second* React, whose hooks throw from inside a component
that looks fine. Publishing the host's copies is the fix; it is what Module
Federation's `shared` does, with the machinery removed.

No build step is deliberate: it keeps this example about packaging and
discovery. A real extension puts a bundle in the same place and changes nothing
else.
