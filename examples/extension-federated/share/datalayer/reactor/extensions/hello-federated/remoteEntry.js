/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * A Module Federation container, by hand, inside a wheel.
 *
 * `frontend/rsbuild.config.ts` beside this package emits a real one into this
 * same directory; this file stands in for it so the example runs with no
 * build. The shape is the protocol: `init` receives the share scope, `get`
 * returns a module factory. Registered as `type: 'esm'` by the server's
 * `remoteType`; a built entry would be a `global` script and need nothing.
 */

let shareScope = {};

export function init(scope) {
  shareScope = scope ?? {};
}

async function shared(name) {
  const versions = shareScope[name];
  if (!versions) {
    throw new Error(`The host did not share ${name}.`);
  }
  const [newest] = Object.keys(versions).sort().reverse();
  return (await versions[newest].get())();
}

export async function get(id) {
  if (id !== './plugin') {
    throw new Error(`This container exposes only ./plugin, not ${id}`);
  }
  const [React, Reactor] = await Promise.all([shared('react'), shared('@datalayer/reactor')]);
  function Panel() {
    const [n, setN] = React.useState(0);
    return React.createElement(
      'div',
      { className: 'card' },
      React.createElement('strong', null, '📦 Hello, federated'),
      React.createElement('p', null, 'pip-installed, and delivered as a container. Clicks: ', n),
      React.createElement('button', { onClick: () => setN(n + 1) }, 'Click'),
    );
  }
  const plugin = Reactor.definePlugin({
    name: '@hello/federated-panel',
    displayName: 'Hello federated panel',
    build: () => ({ components: [{ id: 'hello-federated', slot: 'sidebar', Component: Panel }] }),
  });
  return () => ({ default: plugin });
}
