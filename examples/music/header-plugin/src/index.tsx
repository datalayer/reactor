/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import React, { useRef, useState } from 'react';
import { AnchoredOverlay, Heading, Label, Text } from '@primer/react';
import { AppearanceControlsWithStore, Box, ThemedProvider, useThemeStore } from '@datalayer/primer-addons';
import { UnmuteIcon } from '@primer/octicons-react';
import { definePlugin } from '@datalayer/reactor';
import { ReactorSlot } from '@datalayer/reactor/react';
import { CatalogPlugin, useCatalogSongs } from '@datalayer-examples/reactor-music-catalog-plugin';
import { ShopPlugin, useCart, cartItemCount, cartTotal } from '@datalayer-examples/reactor-music-shop-plugin';

/**
 * Cart summary rendered in the header. Shows the live item count + total from the
 * shared cart store (owned by the shop plugin) and reveals the cart line items in
 * a Primer overlay when the pointer hovers over the summary.
 */
function CartSummary() {
  const lines = useCart((state) => state.lines);
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const items = Object.values(lines);
  const itemCount = cartItemCount(lines);
  const total = cartTotal(lines);

  const openOverlay = () => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
    }
    setOpen(true);
  };
  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  return (
    <AnchoredOverlay
      open={open}
      onOpen={openOverlay}
      onClose={() => setOpen(false)}
      align="end"
      side="outside-bottom"
      overlayProps={{
        sx: {
          bg: 'canvas.overlay',
          color: 'fg.default',
          border: '1px solid',
          borderColor: 'border.default',
          borderRadius: 2,
          boxShadow: 'shadow.large',
        },
      }}
      renderAnchor={(anchorProps) => (
        <Box
          {...anchorProps}
          onMouseEnter={openOverlay}
          onMouseLeave={scheduleClose}
          sx={{ display: 'inline-flex', cursor: 'default' }}
        >
          <Label variant="accent">
            🛒 {itemCount} · ${total.toFixed(2)}
          </Label>
        </Box>
      )}
    >
      <ThemedProvider useStore={useThemeStore}>
        <Box
          onMouseEnter={openOverlay}
          onMouseLeave={scheduleClose}
          sx={{
            p: 3,
            width: 280,
            display: 'grid',
            gap: 2,
          }}
        >
          <Text sx={{ fontWeight: 'bold' }}>Shopping cart</Text>
          {items.length === 0 && <Text sx={{ color: 'fg.muted' }}>Your cart is empty.</Text>}
          {items.map((line) => (
            <Box
              key={line.id}
              sx={{ display: 'flex', justifyContent: 'space-between', gap: 3 }}
            >
              <Text sx={{ minWidth: 0 }}>
                {line.title}
                <Text as="span" sx={{ color: 'fg.muted' }}>
                  {' '}
                  × {line.quantity}
                </Text>
              </Text>
              <Text sx={{ color: 'fg.muted', whiteSpace: 'nowrap' }}>
                ${(line.price * line.quantity).toFixed(2)}
              </Text>
            </Box>
          ))}
          {items.length > 0 && (
            <>
              <Box
                sx={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 3,
                  pt: 2,
                  mt: 1,
                  borderTop: '1px solid',
                  borderColor: 'border.default',
                  fontWeight: 'bold',
                }}
              >
                <Text>Total</Text>
                <Text>${total.toFixed(2)}</Text>
              </Box>
              {/* Whatever plugins offer to do with a cart. The header used
                  to import the checkout plugin's button and draw it here,
                  which meant switching that plugin off left a button opening
                  a page that was gone. A slot has no such opinion: with the
                  checkout plugin off there is simply nothing here. */}
              <ReactorSlot slot="cart-actions" />
            </>
          )}
        </Box>
      </ThemedProvider>
    </AnchoredOverlay>
  );
}

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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Box sx={{ color: 'accent.fg', display: 'inline-flex' }}>
            <UnmuteIcon size={18} />
          </Box>
          <Heading as="h1" sx={{ fontSize: 3, m: 0 }}>
            Reactor Music
          </Heading>
        </Box>
        <Text sx={{ color: 'fg.muted' }}>
          {loading ? 'loading…' : `${songs.length} songs available`}
        </Text>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        <CartSummary />
        <AppearanceControlsWithStore useStore={useThemeStore} />
      </Box>
    </Box>
  );
}

/**
 * Header plugin: depends on the catalog plugin (for the `useCatalogSongs` data
 * service) and the shop plugin (for the shared cart store). Contributes the
 * store header bar with the
 * appearance controls and a live cart summary — hovering the cart reveals its
 * line items plus whatever plugins contribute to `cart-actions`, in a Primer
 * overlay — to the `header` slot.
 */
export const HeaderPlugin = definePlugin({
  name: '@music/header',
  version: '1.0.0',
  displayName: 'Header',
  description: 'The store header, with the cart summary and the theme chooser.',
  octicon: 'browser',
  emoji: '🧭',
  // No dependency on the checkout plugin any more: the header offers a place
  // for cart actions and does not care who fills it, or whether anyone does.
  dependencies: [CatalogPlugin, ShopPlugin],
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
