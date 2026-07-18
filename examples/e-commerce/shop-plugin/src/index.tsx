import React, { useMemo, useState } from 'react';
import { Button, Heading, Label, Text } from '@primer/react';
import { Box, Card } from '@datalayer/primer-addons';
import { defineExtension } from '@datalayer/reactor';
import { CatalogExtension, useCatalogSongs } from '@ecommerce/catalog-plugin';

function Shop() {
  const { songs, loading, error } = useCatalogSongs();
  const [cart, setCart] = useState<Record<string, number>>({});

  const addToCart = (id: string) => {
    setCart((current) => ({ ...current, [id]: (current[id] ?? 0) + 1 }));
  };

  const total = useMemo(
    () => songs.reduce((sum, song) => sum + song.price * (cart[song.id] ?? 0), 0),
    [songs, cart],
  );
  const itemCount = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);

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
              <Button variant="primary" onClick={() => addToCart(song.id)}>
                Add to cart{cart[song.id] ? ` (${cart[song.id]})` : ''}
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
  name: '@ecommerce/shop',
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
