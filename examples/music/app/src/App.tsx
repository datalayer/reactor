import React from 'react';
import { buildPlatformFromExtensions } from '@datalayer/reactor';
import { ReactorProvider, ReactorSlot } from '@datalayer/reactor/react';
import { Box } from '@datalayer/primer-addons';
import { HeaderExtension } from '@music/header-plugin';
import { ShopExtension } from '@music/shop-plugin';
import { useCheckout } from '@music/checkout-plugin';

// The app is purely declarative: it only mounts the header and shop plugins.
// The base catalog plugin and the checkout plugin are pulled in automatically as
// their dependencies, and each contributes its own UI to a slot.
const platform = buildPlatformFromExtensions([HeaderExtension, ShopExtension]);

function Content() {
  // When checkout is open, the checkout page replaces the main store view.
  const checkingOut = useCheckout((state) => state.open);
  return (
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
      {checkingOut ? (
        <ReactorSlot slot="checkout" />
      ) : (
        <>
          <ReactorSlot slot="catalog" />
          <ReactorSlot slot="main" />
        </>
      )}
    </Box>
  );
}

export default function App() {
  return (
    <ReactorProvider platform={platform} availableBackendPlugins={['catalog']}>
      <ReactorSlot slot="header" />
      <Content />
    </ReactorProvider>
  );
}
