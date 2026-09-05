/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The Charts plugin, as source.
 *
 * Note what it imports: `react` and `@datalayer/reactor`, by their bare names,
 * exactly as a bundled plugin would. The container build turns those imports
 * into requests on the share scope, so this file never knows it is remote —
 * which is the whole point of a container over a hand-written module that has
 * to reach for `globalThis.__DATALAYER_REACTOR__.shared`.
 */

import React, { useState } from 'react';
import { definePlugin } from '@datalayer/reactor';

function Charts() {
  const [series, setSeries] = useState([3, 5, 2, 8, 6]);
  const shuffle = () =>
    setSeries((s) => s.map((v) => Math.max(1, v + Math.round(Math.random() * 4 - 2))));
  return (
    <div className="card">
      <strong>📊 Charts — a federated container</strong>
      <p className="lede">
        Built by Rsbuild as a Module Federation container. React arrived through the
        share scope: <code>{series.join(' · ')}</code>
      </p>
      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', height: 48 }}>
        {series.map((v, i) => (
          <div key={i} style={{ width: 18, height: v * 6, background: 'var(--accent, #6a4cff)', borderRadius: 3 }} />
        ))}
      </div>
      <button onClick={shuffle} style={{ marginTop: 8 }}>
        Shuffle
      </button>
    </div>
  );
}

export default definePlugin({
  name: '@remote/charts',
  displayName: 'Charts',
  description: 'Delivered as a Module Federation container, built with Rsbuild.',
  build: () => ({
    components: [{ id: 'charts', slot: 'main', Component: Charts }],
  }),
});
