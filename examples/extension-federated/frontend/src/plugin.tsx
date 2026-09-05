/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import React, { useState } from 'react';
import { definePlugin } from '@datalayer/reactor';

function Panel() {
  const [n, setN] = useState(0);
  return (
    <div className="card">
      <strong>📦 Hello, federated</strong>
      <p>pip-installed, and delivered as a container. Clicks: {n}</p>
      <button onClick={() => setN(n + 1)}>Click</button>
    </div>
  );
}

export default definePlugin({
  name: '@hello/federated-panel',
  displayName: 'Hello federated panel',
  build: () => ({ components: [{ id: 'hello-federated', slot: 'sidebar', Component: Panel }] }),
});
