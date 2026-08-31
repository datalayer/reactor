/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import React from 'react';
import { createRoot } from 'react-dom/client';
import * as Reactor from '@datalayer/reactor';
import { setReactorSharedModules } from '@datalayer/reactor';
import * as ReactorReact from '@datalayer/reactor/react';

import App from './App';
import './styles.css';

/**
 * What a remote is allowed to borrow.
 *
 * Published before anything loads, and before the first render — a remote that
 * arrives to find this empty will bundle its own React, and the resulting
 * broken-hooks error names none of this. `REACTOR_SHARED_MODULES` is the floor
 * the runtime warns about; a host with a design system adds it here.
 */
setReactorSharedModules({
  react: React,
  '@datalayer/reactor': Reactor,
  '@datalayer/reactor/react': ReactorReact,
});

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
