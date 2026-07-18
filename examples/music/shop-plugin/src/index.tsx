import React from 'react';
import { Button, Heading, Label, Text } from '@primer/react';
import { Box, Card } from '@datalayer/primer-addons';
import { defineExtension } from '@datalayer/reactor';
import { create } from 'zustand';
import { CatalogExtension, useCatalogSongs, type Song } from '@music/catalog-plugin';

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
            <Card.Header title={song.title} description={song.artist} />
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
    </Box>
  );
}

/**
 * Shop plugin: depends on the catalog plugin (both as a reactor dependency and
 * by consuming its `useCatalogSongs` data service). Contributes the purchasable
 * song cards and cart to the `main` slot.
 */
export const ShopExtension = defineExtension({
  name: '@music/shop',
  version: '1.0.0',
  dependencies: [CatalogExtension],
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
