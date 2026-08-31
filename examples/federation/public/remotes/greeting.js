/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * A remote that works.
 *
 * Un-built on purpose — a plain ES module the shell imports from a URL. It
 * borrows React and the runtime from the host rather than importing them,
 * because a module fetched at runtime is not in the host's bundle: an
 * `import 'react'` here would hand this plugin a *second* React, whose hooks
 * throw from inside a component that looks perfectly fine.
 */

const { react: React, '@datalayer/reactor': Reactor } =
  globalThis.__DATALAYER_REACTOR__.shared;

function Greeting() {
  const [count, setCount] = React.useState(0);
  return React.createElement(
    'div',
    { className: 'card' },
    React.createElement('strong', null, '👋 Greeting'),
    React.createElement(
      'p',
      null,
      'Fetched from a URL the shell was not built with. It has its own state, ',
      'and it is the host’s React that holds it: ',
      React.createElement('code', null, String(count)),
    ),
    React.createElement(
      'button',
      { onClick: () => setCount(count + 1) },
      'Count up',
    ),
  );
}

export default Reactor.definePlugin({
  name: '@remote/greeting',
  build() {
    return { components: [{ slot: 'main', id: 'greeting', Component: Greeting }] };
  },
});
