/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import React, { useEffect, useState } from 'react';
import { Text } from '@primer/react';
import { Box, Card } from '@datalayer/primer-addons';
import { definePlugin } from '@datalayer/reactor';

/**
 * Default URL of the catalog FastAPI backend (see catalog_plugin package).
 */
export const CATALOG_BACKEND_URL = 'http://localhost:8799';

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
 * Frontend data hook for the catalog. Fetches the song list from the catalog
 * FastAPI backend. This is the shared service that the header and shop plugins
 * consume.
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

function CatalogList() {
  const { songs, loading, error } = useCatalogSongs();

  return (
    <Card border rounded="medium" shadow="small">
      <Card.Header
        title="Songs Catalog"
        description="Served by the catalog plugin frontend + FastAPI backend."
      />
      <Card.Content>
        {loading && <Text sx={{ color: 'fg.muted' }}>Loading catalog…</Text>}
        {error && <Text sx={{ color: 'danger.fg' }}>Failed to load catalog: {error}</Text>}
        {!loading && !error && (
          <Box sx={{ display: 'grid', gap: 2 }}>
            {songs.map((song) => (
              <Box
                key={song.id}
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 3,
                  py: 1,
                  borderBottom: '1px solid',
                  borderColor: 'border.muted',
                }}
              >
                <Text>
                  <strong>{song.title}</strong> — {song.artist}
                </Text>
                <Text sx={{ color: 'fg.muted' }}>${song.price.toFixed(2)}</Text>
              </Box>
            ))}
          </Box>
        )}
      </Card.Content>
    </Card>
  );
}

/**
 * Base catalog extension: contributes the browsable catalog UI to the `catalog`
 * slot and exposes the song data service consumed by the header and shop
 * plugins. Requires the `catalog` backend plugin to be available.
 */
export const CatalogPlugin = definePlugin({
  name: '@music/catalog',
  version: '1.0.0',
  displayName: 'Catalog',
  description:
    'The base plugin: fetches the song catalog and exposes it to every other plugin as the useCatalogSongs hook.',
  octicon: 'book',
  emoji: '🎵',
  requiredBackendPlugins: ['catalog'],
  build() {
    return {
      components: [
        {
          slot: 'catalog',
          id: 'catalog-list',
          Component: CatalogList,
          requiredBackendPlugins: ['catalog'],
        },
      ],
    };
  },
});
