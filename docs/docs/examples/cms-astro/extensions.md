---
sidebar_position: 5
title: Pro and x402 Extensions
---

# Pro and x402 extensions

Core declares contribution points for CMS content types, Astro layout themes,
editor actions and dashboard widgets. Optional Python distributions contribute
to those same points without changing Core. Portable Datalayer themes remain a
framework-neutral export from Primer Addons rather than an extension-specific
Astro layout.

## Install optional extensions

From the Reactor repository root:

```bash
make cms-astro-pro
make cms-astro-x402
```

These are ordinary Python installations. Each package contains a backend plugin
manifest and an embedded JavaScript module under
`share/datalayer/reactor/extensions/`. Refresh the admin page after installing
one so the frontend asks the running Reactor host for the current extension
list.

## Pro

The Pro example contributes:

- an SEO analysis editor action;
- scheduled-publication metadata;
- the Midnight Pro Astro layout theme;
- an editorial audit dashboard widget.

Its backend `analyze` action checks title length, word count and headings and
returns a score. It is deliberately a separate package to demonstrate that a
commercial distribution boundary does not require a separate plugin API.

## x402

The x402 package contributes paid-access controls and a payment-status widget.
Astro middleware adds an `x402` helper to `Astro.locals`, so a paid route can
enforce access before it renders content:

```ts
const payment = await Astro.locals.x402({
  price: '0.25',
  description: 'Read the premium article',
});

if (payment instanceof Response) return payment;
```

Without a payment signature, the extension returns HTTP `402` and a
`PAYMENT-REQUIRED` header. A verified request receives a `PAYMENT-RESPONSE`
receipt.

The included verifier uses a deterministic HMAC signature so the example can
be tested locally without a wallet or network service.

:::warning Production payments
The HMAC verifier is a development fixture, not a blockchain settlement
mechanism. A production deployment should keep the same Reactor/Astro boundary
but delegate verification and settlement to a real x402 facilitator.
:::

See [Python-packaged extensions](/python-packaged-extensions/) for packaging
details and [contribution points](/typescript-plugins/contribution-points/) for
the frontend composition model.
