/// <reference types="astro/client" />

import type { X402Options, X402Receipt } from './lib/x402';

declare global {
  namespace App {
    interface Locals {
      x402(options: X402Options): Promise<Response | X402Receipt>;
    }
  }
}

export {};
