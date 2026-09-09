/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * A Module Federation container, written by hand.
 *
 * A bundler normally emits this file, and `remote-charts/` beside this one
 * shows the Rsbuild configuration that does. It is written out here so the
 * protocol can be read in forty lines rather than inferred from a build: a
 * container is an ES module with two exports, and nothing else.
 *
 * - `init(shareScope)` is the host handing over what it is willing to share.
 *   The scope is keyed by module name, then by version, and each entry is a
 *   factory. A container reads its React from here — *never* from its own
 *   bundle — which is what makes it one React and not two.
 * - `get(id)` answers "which module do you expose as `./plugin`?" with a
 *   factory the host calls once.
 *
 * Registered with `type: 'esm'`, because that is what this file is. A bundler
 * would emit a `global` entry that sets `globalThis.reactor_charts` instead;
 * the host does not care which, and says so through one field.
 */

let shareScope = {};

export function init(scope) {
  shareScope = scope ?? {};
}

/** The newest version of a shared module the host published. */
async function shared(name) {
  const versions = shareScope[name];
  if (!versions) {
    throw new Error(`The host did not share ${name}; the container cannot draw.`);
  }
  const [newest] = Object.keys(versions).sort().reverse();
  const entry = versions[newest];
  const factory = await entry.get();
  return factory();
}

function makePlugin(React, Reactor) {
  function Charts() {
    const [series, setSeries] = React.useState([3, 5, 2, 8, 6]);
    const bump = () => setSeries((s) => s.map((v) => Math.max(1, v + Math.round(Math.random() * 4 - 2))));
    return React.createElement(
      'div',
      { className: 'card' },
      React.createElement('strong', null, '📊 Charts — a federated container'),
      React.createElement(
        'p',
        { className: 'lede' },
        'Loaded through Module Federation. Its React is the host’s React, handed over in the share scope — ',
        'so this state lives in the same tree as everything else: ',
        React.createElement('code', null, series.join(' · ')),
      ),
      React.createElement(
        'div',
        { style: { display: 'flex', gap: '4px', alignItems: 'flex-end', height: 48 } },
        series.map((v, i) =>
          React.createElement('div', {
            key: i,
            style: { width: 18, height: v * 6, background: 'var(--accent, #6a4cff)', borderRadius: 3 },
          }),
        ),
      ),
      React.createElement('button', { onClick: bump, style: { marginTop: 8 } }, 'Shuffle'),
    );
  }

  return Reactor.definePlugin({
    name: '@remote/charts',
    displayName: 'Charts',
    description: 'Delivered as a Module Federation container, not a plain module.',
    build: () => ({
      components: [{ id: 'charts', slot: 'main', Component: Charts }],
    }),
  });
}

export async function get(id) {
  if (id !== './plugin') {
    throw new Error(`This container exposes only ./plugin, not ${id}`);
  }
  const [React, Reactor] = await Promise.all([shared('react'), shared('@datalayer/reactor')]);
  const plugin = makePlugin(React, Reactor);
  return () => ({ default: plugin });
}
