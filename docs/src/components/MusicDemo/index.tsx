/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/*
 * Copyright (c) 2025-2026 Datalayer, Inc.
 * Distributed under the terms of the Modified BSD License.
 */

/**
 * `<MusicDemo />` — the music example, mounted in an MDX page.
 *
 * Client-only on purpose. The example builds its platform at module scope and
 * its plugins reach for `window.fetch`, neither of which a static prerender
 * can do.
 *
 * Two things enforce that, and both are needed. `BrowserOnly` stops the
 * component from *rendering* during a prerender, and the `@reactor-music-demo`
 * alias — resolved to the real module for the browser and to nothing for the
 * server (see `docusaurus.config.js`) — stops it from being *compiled* into the
 * server bundle at all. Without the second, webpack still walks the whole
 * example and its design system for a page that will never draw them.
 */

import React from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

/** What stands in the demo's place while its chunk is on the wire. */
function Loading() {
  return (
    <div
      style={{
        border: '1px solid var(--ifm-color-emphasis-300)',
        borderRadius: 6,
        padding: '4rem 1rem',
        textAlign: 'center',
        color: 'var(--ifm-color-emphasis-600)',
      }}
    >
      Starting the reactor…
    </div>
  );
}

export default function MusicDemo(): JSX.Element {
  return (
    <BrowserOnly fallback={<Loading />}>
      {() => {
        const MusicApp = require('@reactor-music-demo').default;
        return <MusicApp />;
      }}
    </BrowserOnly>
  );
}
