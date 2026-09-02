/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import React from 'react';
import { Button, Heading, Label, Text } from '@primer/react';
import { Box, Card } from '@datalayer/primer-addons';
import { BoringAvatar } from '@datalayer/core/lib/components/avatars';
import { useThemeStore } from '@datalayer/primer-addons';
import { definePlugin } from '@datalayer/reactor';
import { ReactorSlot } from '@datalayer/reactor/react';
import { create } from 'zustand';
import { CatalogPlugin, useCatalogSongs, type Song } from '@datalayer-examples/reactor-music-catalog-plugin';

/**
 * A single line in the shopping cart: a catalog song plus the quantity added.
 */
export type CartLine = Song & { quantity: number };

type CartState = {
  lines: Record<string, CartLine>;
  addToCart: (song: Song) => void;
  removeFromCart: (id: string) => void;
  clear: () => void;
};

/**
 * Shared cart store owned by the shop plugin. Both the shop UI (this plugin) and
 * the header cart summary (header plugin) subscribe to it, so adding an item in
 * the shop instantly updates the header cart badge and overlay.
 */
export const useCart = create<CartState>((set) => ({
  lines: {},
  addToCart: (song) =>
    set((state) => {
      const existing = state.lines[song.id];
      return {
        lines: {
          ...state.lines,
          [song.id]: { ...song, quantity: (existing?.quantity ?? 0) + 1 },
        },
      };
    }),
  removeFromCart: (id) =>
    set((state) => {
      const next = { ...state.lines };
      delete next[id];
      return { lines: next };
    }),
  clear: () => set({ lines: {} }),
}));

/** Total number of items (summed quantities) in the cart. */
export function cartItemCount(lines: Record<string, CartLine>): number {
  return Object.values(lines).reduce((sum, line) => sum + line.quantity, 0);
}

/** Total price of all items in the cart. */
export function cartTotal(lines: Record<string, CartLine>): number {
  return Object.values(lines).reduce((sum, line) => sum + line.price * line.quantity, 0);
}

function Shop() {
  const { songs, loading, error } = useCatalogSongs();
  const lines = useCart((state) => state.lines);
  const addToCart = useCart((state) => state.addToCart);
  const { colorMode } = useThemeStore();

  const avatarColors = React.useMemo(
    () =>
      colorMode === 'dark'
        ? ['#7EE787', '#58A6FF', '#A5D6FF', '#8B949E', '#79C0FF']
        : ['#2DA44E', '#0969DA', '#54AEFF', '#57606A', '#1F6FEB'],
    [colorMode],
  );

  const total = cartTotal(lines);
  const itemCount = cartItemCount(lines);

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Heading as="h2" sx={{ fontSize: 3, m: 0 }}>
          Shop
        </Heading>
        <Label variant="accent">
          {itemCount} items · ${total.toFixed(2)}
        </Label>
      </Box>

      {loading && <Text sx={{ color: 'fg.muted' }}>Loading shop…</Text>}
      {error && <Text sx={{ color: 'danger.fg' }}>Failed to load shop: {error}</Text>}

      <Box sx={{ display: 'grid', gridTemplateColumns: ['1fr', '1fr 1fr'], gap: 3 }}>
        {songs.map((song) => (
          <Card key={song.id} border rounded="medium" shadow="small">
            <Card.Header
              title={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <BoringAvatar
                    displayName={`${song.artist}-${song.title}`}
                    variant="beam"
                    square
                    size={30}
                    colors={avatarColors}
                  />
                  <Box sx={{ display: 'grid', minWidth: 0 }}>
                    <Text sx={{ fontWeight: 600, lineHeight: 1.2 }}>{song.title}</Text>
                    <Text sx={{ color: 'fg.muted', fontSize: 1, lineHeight: 1.2 }}>{song.artist}</Text>
                  </Box>
                </Box>
              }
            />
            <Card.Content>
              <Text sx={{ color: 'fg.muted' }}>${song.price.toFixed(2)}</Text>
            </Card.Content>
            <Card.Actions>
              <Button variant="primary" onClick={() => addToCart(song)}>
                Add to cart{lines[song.id] ? ` (${lines[song.id].quantity})` : ''}
              </Button>
            </Card.Actions>
          </Card>
        ))}
      </Box>

      {/* Cart actions, under the songs, where the shopper's hands already are.
          The shop knows nothing about checkout — it offers a place and the
          checkout plugin fills it. With that plugin switched off there is
          nothing here, and the shop is otherwise unchanged. */}
      <ReactorSlot slot="cart-actions" />
    </Box>
  );
}

/**
 * Shop plugin: depends on the catalog plugin (both as a reactor dependency and
 * by consuming its `useCatalogSongs` data service). Contributes the purchasable
 * song cards and cart to the `main` slot.
 */
export const ShopPlugin = definePlugin({
  name: '@music/shop',
  // Declared rather than registered in a phase: neither command needs anything
  // the build produced, and a command that can be read off the plugin is one a
  // host can show before the plugin has run.
  commands: [
    {
      id: 'music.shop.clearCart',
      name: 'Clear the cart',
      description: 'Remove every song from the cart',
      emoji: '🧹',
      octicon: 'trash',
      category: 'Shop',
      keybinding: 'Mod+Alt+Backspace',
      // Nothing to clear is not an error, it is an unavailable command — the
      // palette greys it out and says so rather than hiding it.
      isEnabled: () => Object.keys(useCart.getState().lines).length > 0,
      execute: () => useCart.getState().clear(),
    },
  ],
  version: '1.0.0',
  displayName: 'Shop',
  description:
    'Purchasable song cards and the shared cart store the header and checkout read.',
  octicon: 'package',
  emoji: '🛒',
  dependencies: [CatalogPlugin],
  requiredBackendPlugins: ['catalog'],
  build() {
    return {
      components: [
        {
          slot: 'main',
          id: 'shop',
          Component: Shop,
          requiredBackendPlugins: ['catalog'],
        },
      ],
    };
  },
});
