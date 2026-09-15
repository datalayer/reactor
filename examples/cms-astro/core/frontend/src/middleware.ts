import { defineMiddleware } from 'astro:middleware';

import { enforceX402 } from './lib/x402';

export const onRequest = defineMiddleware(async ({ locals, request }, next) => {
  locals.x402 = (options) => enforceX402(request, options);
  return next();
});
