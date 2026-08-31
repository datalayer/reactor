/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * `<CmsDemo />` — the CMS example, mounted in an MDX page.
 *
 * Client-only, and kept out of the server bundle entirely by the
 * `@reactor-cms-demo` alias (see `docusaurus.config.js`): the demo patches
 * `window.fetch` and builds a platform, neither of which a prerender can do.
 */

import React from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';

function Loading() {
  return (
    <div
      style={{
        border: '1px solid var(--ifm-color-emphasis-300)',
        borderRadius: 8,
        padding: '4rem 1rem',
        textAlign: 'center',
        color: 'var(--ifm-color-emphasis-600)',
      }}
    >
      Starting the CMS…
    </div>
  );
}

export default function CmsDemo(): JSX.Element {
  return (
    <BrowserOnly fallback={<Loading />}>
      {() => {
        const CmsApp = require('@reactor-cms-demo').default;
        return <CmsApp />;
      }}
    </BrowserOnly>
  );
}
