import React from 'react';
import { createRoot } from 'react-dom/client';
import { BaseStyles } from '@primer/react';
import { ThemedProvider, setupPrimerPortals, useThemeStore } from '@datalayer/primer-addons';
import { App } from './App';

setupPrimerPortals();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ThemedProvider useStore={useThemeStore}>
      <BaseStyles>
        <App />
      </BaseStyles>
    </ThemedProvider>
  </React.StrictMode>,
);
