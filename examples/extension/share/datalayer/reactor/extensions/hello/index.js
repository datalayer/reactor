/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The frontend half of the hello extension.
 *
 * Deliberately un-built: a plain ES module the browser imports straight from
 * the URL the server serves it at. No bundler runs over this file, which keeps
 * this example about *packaging and discovery* rather than about a toolchain —
 * and means the whole chain works today, before the Rsbuild migration.
 *
 * What it may not do is `import` anything. A module fetched at runtime is not
 * part of the host's bundle, so an `import 'react'` here would either fail or —
 * far worse — succeed and give this plugin a *second* React, whose hooks throw
 * from inside a component that looks fine. So the host publishes its own
 * copies and this module borrows them. That is exactly what Module Federation
 * does with `shared`; this is the same idea with the machinery removed, and it
 * is the seam MF replaces later.
 */

const shared = globalThis.__DATALAYER_REACTOR__?.shared;

if (!shared) {
  throw new Error(
    '@hello/panel: the host published no shared modules. ' +
      'Call setReactorSharedModules() from @datalayer/reactor before loading extensions.',
  );
}

const React = shared['react'];
const { definePlugin } = shared['@datalayer/reactor'];

/** Asks the Python half for its greeting, through the platform's invoke API. */
function useGreeting(backendUrl) {
  const [greeting, setGreeting] = React.useState(null);
  const [error, setError] = React.useState(null);

  React.useEffect(() => {
    let active = true;
    fetch(`${backendUrl}/plugins/hello/invoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'greet', payload: { name: 'Reactor' } }),
    })
      .then(response => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return response.json();
      })
      .then(answer => {
        if (active) {
          setGreeting(answer?.result?.greeting ?? answer?.greeting ?? null);
        }
      })
      .catch(caught => active && setError(String(caught)))
    return () => {
      active = false;
    };
  }, [backendUrl]);

  return { greeting, error };
}

function HelloPanel({ backendUrl = 'http://localhost:8799' }) {
  const { greeting, error } = useGreeting(backendUrl);

  // `createElement` rather than JSX for the same reason there is no `import`:
  // nothing compiles this file.
  return React.createElement(
    'div',
    {
      style: {
        border: '1px solid currentColor',
        borderRadius: 6,
        padding: 12,
        marginTop: 12,
        opacity: 0.9,
      },
    },
    React.createElement(
      'strong',
      { style: { display: 'block', marginBottom: 4 } },
      '👋 Hello panel',
    ),
    React.createElement(
      'span',
      { style: { fontSize: 12 } },
      error
        ? `Backend unreachable: ${error}`
        : greeting ?? 'Asking the Python half…',
    ),
    React.createElement(
      'div',
      { style: { fontSize: 11, marginTop: 6, opacity: 0.7 } },
      'Installed with pip, into a server that was already running.',
    ),
  );
}

/**
 * The plugin.
 *
 * It says less than the manifest the server already handed the host — no
 * name, no description, no icon — because it does not need to: the reference
 * built from `FrontendPlugin` fills those in, and what the module says wins
 * only where it says something. This is the manifest/entry-point split, and
 * this file is the entry point.
 */
export default definePlugin({
  name: '@hello/panel',
  requiredBackendPlugins: ['hello'],
  build() {
    return {
      components: [
        {
          slot: 'sidebar',
          id: 'hello-panel',
          Component: HelloPanel,
          requiredBackendPlugins: ['hello'],
        },
      ],
    };
  },
});
