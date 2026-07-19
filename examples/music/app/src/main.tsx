/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import { ThemedProvider, setupPrimerPortals, useThemeStore } from '@datalayer/primer-addons';
import App from './App';

import './styles.css';

setupPrimerPortals();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemedProvider useStore={useThemeStore}>
      <App />
    </ThemedProvider>
  </React.StrictMode>,
);
