import React from 'react';
import { buildReactorFromExtensions } from '@datalayer/reactor';
import { ReactorSlot, useReactor } from '@datalayer/reactor/react';
import { Box } from '@datalayer/primer-addons';
import { HeaderExtension } from '@datalayer-examples/reactor-music-header-plugin';
import { ShopExtension } from '@datalayer-examples/reactor-music-shop-plugin';
import { useCheckout } from '@datalayer-examples/reactor-music-checkout-plugin';

// The app is purely declarative: it only mounts the header and shop plugins.
// The base catalog plugin and the checkout plugin are pulled in automatically as
// their dependencies, and each contributes its own UI to a slot.
const reactor = buildReactorFromExtensions([HeaderExtension, ShopExtension]);

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
  useReactor(reactor, { availableBackendPlugins: ['catalog'] });
  return (
    <>
      <ReactorSlot slot="header" />
      <Content />
    </>
  );
}
