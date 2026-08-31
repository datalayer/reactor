/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * A remote nothing references.
 *
 * It is not in the shell's plugin list and no code imports it. The only way it
 * reaches the page is somebody pasting its URL into the box — which is what a
 * marketplace install is, with the marketplace removed.
 */

const { react: React, '@datalayer/reactor': Reactor } =
  globalThis.__DATALAYER_REACTOR__.shared;

function Late() {
  return React.createElement(
    'div',
    { className: 'card' },
    React.createElement('strong', null, '📦 Installed at runtime'),
    React.createElement(
      'p',
      null,
      'This plugin was not in the bundle, not in the plugin list, and not ',
      'named by any code in the shell. It arrived because a URL was typed in.',
    ),
  );
}

export default Reactor.definePlugin({
  name: '@remote/late',
  build() {
    return { components: [{ slot: 'main', id: 'late', Component: Late }] };
  },
});
