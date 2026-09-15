/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

export type X402Options = {
  price?: string;
  description?: string;
  network?: string;
  payTo?: string;
};

export type X402Receipt = { paid: true; receipt?: Record<string, unknown> };
type Enforcement = { paid: boolean; status: number; headers?: Record<string, string>; body?: unknown; receipt?: Record<string, unknown> };

/** Invoke the optional Python x402 extension and translate its result to HTTP. */
export async function enforceX402(request: Request, options: X402Options, apiUrl = process.env.CMS_API_URL ?? 'http://localhost:8791'): Promise<Response | X402Receipt> {
  const response = await fetch(`${apiUrl}/plugins/cms-astro.x402/invoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'enforce',
      payload: {
        ...options,
        method: request.method,
        path: new URL(request.url).pathname,
        paymentSignature: request.headers.get('payment-signature') ?? request.headers.get('x-payment'),
      },
    }),
  });
  if (!response.ok) {
    return new Response('The cms-astro x402 extension is not installed or unavailable.', { status: 503 });
  }
  const result = (await response.json()) as Enforcement;
  if (!result.paid) {
    return new Response(JSON.stringify(result.body), {
      status: result.status || 402,
      headers: { 'content-type': 'application/json', ...result.headers },
    });
  }
  return { paid: true, receipt: result.receipt };
}
