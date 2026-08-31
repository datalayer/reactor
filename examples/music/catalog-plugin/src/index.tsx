/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import React from 'react';
import { Text } from '@primer/react';
import { Box, Card } from '@datalayer/primer-addons';
import { definePlugin } from '@datalayer/reactor';
import {
  CATALOG_BACKEND_URL,
  useCatalogSongs,
} from '@datalayer-examples/reactor-music-catalog-core';

/**
 * The data contract lives in `catalog-core`, which imports no design system.
 *
 * It is re-exported here so that a plugin already depending on this one keeps
 * working — but a plugin that only wants the *songs* should import the core
 * directly, and pay for React rather than for Primer. The
 * [shadcn store](../../music-shadcn) does exactly that, which is the reason the
 * split exists at all.
 */
export {
  CATALOG_BACKEND_URL,
  useCatalogSongs,
  type CatalogState,
  type Song,
} from '@datalayer-examples/reactor-music-catalog-core';

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
