/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The document being edited, outside React.
 *
 * It was `useState` in the component, which was right until commands existed:
 * a command is registered by a plugin and invoked from a palette, neither of
 * which is inside the component tree, so the document has to be reachable
 * without a hook. Everything else is unchanged — the component still reads it
 * through `useSyncExternalStore` and re-renders on every write.
 *
 * Deliberately hand-rolled rather than a state library: the CMS example's
 * subject is the plugin model, and a dependency here would be one more thing to
 * explain that has nothing to do with it.
 */

import type { Doc } from './points';

export const STARTING_DOC: Doc = {
  title: 'Hello from the CMS',
  body: 'Write something, then reach for a tool.\n',
  contentType: '',
};

let current: Doc = STARTING_DOC;
const listeners = new Set<() => void>();

export const docStore = {
  get(): Doc {
    return current;
  },
  set(next: Doc): void {
    current = next;
    for (const listener of [...listeners]) {
      listener();
    }
  },
  update(change: Partial<Doc>): void {
    docStore.set({ ...current, ...change });
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
