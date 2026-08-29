/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import React from 'react';
import { Button, Heading, Text } from '@primer/react';
import { Box } from '@datalayer/primer-addons';
import { definePlugin } from '@datalayer/reactor';
import { create } from 'zustand';
import { ShopPlugin, useCart, cartItemCount, cartTotal } from '@datalayer-examples/reactor-music-shop-plugin';

type CheckoutState = {
  /** Whether the checkout page is currently shown. */
  open: boolean;
  /**
   * Whether the order has been placed — i.e. which of the two checkout views
   * is on screen.
   *
   * In the store rather than in `CheckoutPage`'s own state, because it is no
   * longer one component's business: the aside beside the page shows a
   * different emoji for each view, and a `useState` inside the page would be
   * invisible to it. Two components rendering one plugin's two views need one
   * place to read that from.
   */
  placed: boolean;
  openCheckout: () => void;
  placeOrder: () => void;
  closeCheckout: () => void;
};

/**
 * Shared checkout store owned by the checkout plugin. The `CheckoutButton`
 * (rendered inside the header cart overlay) flips `open` to reveal the
 * `CheckoutPage`, which is contributed to the `checkout` slot.
 */
export const useCheckout = create<CheckoutState>((set) => ({
  open: false,
  placed: false,
  openCheckout: () => set({ open: true, placed: false }),
  placeOrder: () => set({ placed: true }),
  // Leaving resets the confirmation: reopening checkout must start at the
  // cart, not at somebody's last receipt.
  closeCheckout: () => set({ open: false, placed: false }),
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
  const close = useCheckout((state) => state.closeCheckout);
  const placed = useCheckout((state) => state.placed);
  const confirm = useCheckout((state) => state.placeOrder);
  const lines = useCart((state) => state.lines);
  const clear = useCart((state) => state.clear);

  const items = Object.values(lines);
  const itemCount = cartItemCount(lines);
  const total = cartTotal(lines);

  const placeOrder = () => {
    confirm();
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

/** What the aside shows for each of the checkout plugin's two views. */
const ASIDE = {
  checkout: {
    emoji: '\u{1F6D2}',
    caption: 'Check the cart, then place the order.',
  },
  placed: {
    emoji: '\u{1F4E6}',
    caption: 'Packed and on its way.',
  },
} as const;

/**
 * The picture beside the checkout, in the second column.
 *
 * Contributed by the checkout plugin rather than drawn by the application, so
 * that which emoji belongs to which view is decided where the views are. The
 * app knows it has a second column to fill; it does not know that "order
 * confirmed" is one of the states this plugin can be in, and it should not
 * have to.
 */
function CheckoutAside() {
  const placed = useCheckout((state) => state.placed);
  const { emoji, caption } = placed ? ASIDE.placed : ASIDE.checkout;

  return (
    <Box
      sx={{
        display: 'grid',
        gap: 3,
        justifyItems: 'center',
        alignContent: 'center',
        textAlign: 'center',
        // Tall enough to sit beside the page rather than above its own
        // whitespace, without stretching to match a long cart.
        minHeight: 240,
        p: 4,
      }}
    >
      {/* Decorative: the caption below says the same thing, and a screen
          reader announcing "shopping trolley" between the two would be
          repeating the page it sits next to. */}
      <Box as="span" aria-hidden sx={{ fontSize: 96, lineHeight: 1 }}>
        {emoji}
      </Box>
      <Text sx={{ color: 'fg.muted' }}>{caption}</Text>
    </Box>
  );
}

/**
 * Checkout plugin: depends on the shop plugin (for the shared `useCart` store and
 * cart helpers). Provides the `CheckoutButton` (rendered by the header plugin in
 * its cart overlay) and contributes two components: the `CheckoutPage` to the
 * `checkout` slot, and the `CheckoutAside` that sits beside it to
 * `checkout-aside`. Two slots rather than one component drawing both columns,
 * so the application decides the layout and the plugin decides the content.
 */
export const CheckoutPlugin = definePlugin({
  name: '@music/checkout',
  version: '1.0.0',
  displayName: 'Checkout',
  description: 'Turns the cart into an order: the Checkout button and the checkout page.',
  octicon: 'credit-card',
  emoji: '💳',
  dependencies: [ShopPlugin],
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
        {
          slot: 'checkout-aside',
          id: 'checkout-aside',
          Component: CheckoutAside,
          requiredBackendPlugins: ['catalog'],
        },
      ],
    };
  },
});
