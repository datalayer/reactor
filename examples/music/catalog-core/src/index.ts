/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The catalog's data contract, with no user interface in it.
 *
 * This package exists because of something the store demonstrated by accident.
 * `catalog-plugin` used to hold both the `useCatalogSongs` hook *and* a Primer
 * card that draws it — so every plugin that wanted the songs imported Primer,
 * whether it drew anything with it or not. That is invisible while every plugin
 * uses the same design system, and fatal the moment one does not: a store built
 * with a different kit could not read this catalog without pulling in the kit
 * it was trying not to use.
 *
 * The rule the split makes concrete: **a plugin whose contract is a record
 * travels; one whose contract is a component does not.** What crosses a
 * boundary here is `Song` — a shape, not a card.
 *
 * @module catalog-core
 */

import { useEffect, useState } from 'react';

/**
 * Injected by the bundler when the API is somewhere other than this origin.
 *
 * Declared rather than imported because it is a build-time constant: the
 * development server replaces it, and a production build leaves it undefined so
 * the `typeof` guard below falls through.
 */
declare const __REACTOR_BACKEND_URL__: string | undefined;

/**
 * Where the catalog API is.
 *
 * Same origin by default, which is what makes `datalayer-music-example` work:
 * the Python host serves this interface *and* the API, so there is no second
 * address to configure and nothing to get wrong between them.
 *
 * It was a hard-coded `http://localhost:8799`, and that was the quiet reason
 * the example needed two servers and a CORS policy. Development still needs the
 * split — Rsbuild on one port, uvicorn on another — so the dev build injects the
 * URL and the production build does not.
 */
function resolveBackendUrl(): string {
  // `typeof` on an undeclared identifier is safe; a bundler that never defined
  // this simply falls through, which is what the documentation site does.
  const injected =
    typeof __REACTOR_BACKEND_URL__ !== 'undefined' ? __REACTOR_BACKEND_URL__ : undefined;
  if (injected) {
    return injected;
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  // Server-side rendering, or a test: the address the example documents.
  return 'http://localhost:8799';
}

export const CATALOG_BACKEND_URL = resolveBackendUrl();

export type Song = {
  id: string;
  title: string;
  artist: string;
  price: number;
};

export type CatalogState = {
  songs: Song[];
  loading: boolean;
  error: string | null;
};

/**
 * The song list, from the catalog backend.
 *
 * The one thing every view of this store needs, in whatever kit it is drawn
 * with. It imports React — a hook has to — and nothing else.
 */
export function useCatalogSongs(baseUrl: string = CATALOG_BACKEND_URL): CatalogState {
  const [songs, setSongs] = useState<Song[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetch(`${baseUrl}/api/catalog/songs`)
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        return (await response.json()) as Song[];
      })
      .then((data) => {
        if (active) {
          setSongs(data);
          setError(null);
        }
      })
      .catch((caught) => {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'unknown error');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [baseUrl]);

  return { songs, loading, error };
}
