import React, { useState } from 'react';
import { Button, Heading, Text } from '@primer/react';
import { Box } from '@datalayer/primer-addons';
import { defineExtension } from '@datalayer/reactor';
import { create } from 'zustand';
import { ShopExtension, useCart, cartItemCount, cartTotal } from '@datalayer-examples/reactor-music-shop-plugin';

type CheckoutState = {
  /** Whether the checkout page is currently shown. */
  open: boolean;
  openCheckout: () => void;
  closeCheckout: () => void;
};

/**
 * Shared checkout store owned by the checkout plugin. The `CheckoutButton`
 * (rendered inside the header cart overlay) flips `open` to reveal the
 * `CheckoutPage`, which is contributed to the `checkout` slot.
 */
export const useCheckout = create<CheckoutState>((set) => ({
  open: false,
  openCheckout: () => set({ open: true }),
  closeCheckout: () => set({ open: false }),
}));

/**
 * Checkout trigger. Provided by the checkout plugin and rendered by the header
 * plugin inside its cart overlay. Disabled while the cart is empty; clicking it
 * opens the checkout page.
 */
export function CheckoutButton() {
  const lines = useCart((state) => state.lines);
  const openCheckout = useCheckout((state) => state.openCheckout);
  const itemCount = cartItemCount(lines);

  return (
    <Button
      variant="primary"
      block
      disabled={itemCount === 0}
      onClick={openCheckout}
    >
      Checkout
    </Button>
  );
}

/**
 * Checkout page. Provided by the checkout plugin and contributed to the
 * `checkout` slot. Rendered inline in place of the main store view when
 * `useCheckout.open` is true; summarises the cart, lets the shopper place the
 * order (clearing the shared cart store), and confirms the purchase.
 */
function CheckoutPage() {
  const closeCheckout = useCheckout((state) => state.closeCheckout);
  const lines = useCart((state) => state.lines);
  const clear = useCart((state) => state.clear);
  const [placed, setPlaced] = useState(false);

  const items = Object.values(lines);
  const itemCount = cartItemCount(lines);
  const total = cartTotal(lines);

  const close = () => {
    setPlaced(false);
    closeCheckout();
  };

  const placeOrder = () => {
    setPlaced(true);
    clear();
  };

  return (
    <Box
      sx={{
        width: '100%',
        bg: 'canvas.default',
        borderRadius: 2,
        border: '1px solid',
        borderColor: 'border.default',
        p: 4,
        display: 'grid',
        gap: 3,
      }}
    >
      {placed ? (
        <>
          <Heading as="h2" sx={{ fontSize: 3, m: 0 }}>
            🎉 Order confirmed
          </Heading>
          <Text sx={{ color: 'fg.muted' }}>
            Thanks for your purchase! Your songs are on their way.
          </Text>
          <Button variant="primary" onClick={close}>
            Continue shopping
          </Button>
        </>
      ) : (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Heading as="h2" sx={{ fontSize: 3, m: 0 }}>
              Checkout
            </Heading>
            <Button variant="invisible" onClick={close}>
              ← Back to store
            </Button>
          </Box>

          {items.length === 0 ? (
            <Text sx={{ color: 'fg.muted' }}>Your cart is empty.</Text>
          ) : (
            <Box sx={{ display: 'grid', gap: 2 }}>
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
                <Text>Total ({itemCount})</Text>
                <Text>${total.toFixed(2)}</Text>
              </Box>
            </Box>
          )}

          <Button
            variant="primary"
            disabled={items.length === 0}
            onClick={placeOrder}
          >
            Place order
          </Button>
        </>
      )}
    </Box>
  );
}

/**
 * Checkout plugin: depends on the shop plugin (for the shared `useCart` store and
 * cart helpers). Provides the `CheckoutButton` (rendered by the header plugin in
 * its cart overlay) and contributes the `CheckoutPage` modal to the `checkout`
 * slot.
 */
export const CheckoutExtension = defineExtension({
  name: '@music/checkout',
  version: '1.0.0',
  dependencies: [ShopExtension],
  requiredBackendPlugins: ['catalog'],
  build() {
    return {
      components: [
        {
          slot: 'checkout',
          id: 'checkout-page',
          Component: CheckoutPage,
          requiredBackendPlugins: ['catalog'],
        },
      ],
    };
  },
});
