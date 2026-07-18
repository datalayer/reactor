import React from 'react';
import { Heading, Text } from '@primer/react';
import { AppearanceControlsWithStore, Box, useThemeStore } from '@datalayer/primer-addons';
import { defineExtension } from '@datalayer/reactor';
import { CatalogExtension, useCatalogSongs } from '@ecommerce/catalog-plugin';

function StoreHeader() {
  const { songs, loading } = useCatalogSongs();

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 2,
        px: 3,
        py: 2,
        borderBottom: '1px solid',
        borderColor: 'border.default',
        bg: 'canvas.default',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
        <Heading as="h1" sx={{ fontSize: 3, m: 0 }}>
          🎵 Datalayer Music
        </Heading>
        <Text sx={{ color: 'fg.muted' }}>
          {loading ? 'loading…' : `${songs.length} songs available`}
        </Text>
      </Box>
      <AppearanceControlsWithStore useStore={useThemeStore} />
    </Box>
  );
}

/**
 * Header plugin: depends on the catalog plugin (both as a reactor dependency and
 * by consuming its `useCatalogSongs` data service). Contributes the store header
 * bar with the appearance controls to the `header` slot.
 */
export const HeaderExtension = defineExtension({
  name: '@ecommerce/header',
  version: '1.0.0',
  dependencies: [CatalogExtension],
  requiredBackendPlugins: ['catalog'],
  build() {
    return {
      components: [
        {
          slot: 'header',
          id: 'store-header',
          Component: StoreHeader,
          requiredBackendPlugins: ['catalog'],
        },
      ],
    };
  },
});
