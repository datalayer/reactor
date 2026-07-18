import React from 'react';
import { buildPlatformFromExtensions } from '@datalayer/reactor';
import { ReactorProvider, ReactorSlot } from '@datalayer/reactor/react';
import { Box } from '@datalayer/primer-addons';
import { HeaderExtension } from '@ecommerce/header-plugin';
import { ShopExtension } from '@ecommerce/shop-plugin';

// The app is purely declarative: it only mounts the header and shop plugins.
// The base catalog plugin is pulled in automatically as their dependency, and
// contributes its own UI to the `catalog` slot.
const platform = buildPlatformFromExtensions([HeaderExtension, ShopExtension]);

export default function App() {
  return (
    <ReactorProvider platform={platform} availableBackendPlugins={['catalog']}>
      <ReactorSlot slot="header" />
      <Box
        sx={{
          maxWidth: 960,
          mx: 'auto',
          px: 3,
          py: 4,
          display: 'grid',
          gap: 4,
        }}
      >
        <ReactorSlot slot="catalog" />
        <ReactorSlot slot="main" />
      </Box>
    </ReactorProvider>
  );
}
