/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import React from 'react';
import { definePlugin } from '@datalayer/reactor';

function Panel() {
  return (
    <div>
      <strong>__NAME__</strong>
      <p>Delivered by one pip install, as a Module Federation container.</p>
    </div>
  );
}

export default definePlugin({
  name: '__PLUGIN__',
  displayName: '__NAME__',
  build: () => ({ components: [{ id: '__NAME__', slot: 'sidebar', Component: Panel }] }),
});
