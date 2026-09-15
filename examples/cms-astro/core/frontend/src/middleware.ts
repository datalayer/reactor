/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import { defineMiddleware } from 'astro:middleware';

import { enforceX402 } from './lib/x402';

export const onRequest = defineMiddleware(async ({ locals, request }, next) => {
  locals.x402 = (options) => enforceX402(request, options);
  return next();
});
