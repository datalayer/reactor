/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The Pro extension's browser half.
 *
 * Compare it with the Core one: same shape, same imports, same points, same
 * `definePlugin`. There is no paid-plugin API, because there is no reason for
 * one — "pro" is a fact about who may download this wheel, and the extension
 * mechanism never learns it.
 *
 * The AI assistant is the exception worth reading. Two of these plugins
 * contribute records and draw nothing; that one draws a panel, and does it with
 * the *host's* design system, borrowed through the shared modules. It never
 * imports shadcn/ui, never names a CSS class, and inherits the CMS's theme —
 * which is what "the kit is the host's to hand over" means in practice.
 */

const shared = globalThis.__DATALAYER_REACTOR__?.shared;

if (!shared) {
  throw new Error('@cms-pro: the host published no shared modules.');
}

const React = shared['react'];
const { definePlugin, defineContributionPoint, contribution } = shared['@datalayer/reactor'];
// The host's kit. Absent in a host that publishes none — hence the fallback
// below, because a plugin that crashes a CMS because it wanted a nicer button
// has its priorities wrong.
const ui = shared['@cms/ui'] ?? {};

const EditorToolbar = defineContributionPoint('cms.editorToolbar');
const ContentTypes = defineContributionPoint('cms.contentType');
const PublishLifecycle = defineContributionPoint('cms.publishLifecycle');

// --- AI Writing Assistant → Editor Toolbar (and an aside) -------------------

/** Not a language model. A joke about one, which is the honest amount here. */
const rewrite = (body) =>
  body
    .split('\n')
    .map((line) => (line.trim() ? line.replace(/\b(very|really|just)\s+/gi, '') : line))
    .join('\n')
    .replace(/\s+$/, '\n');

function Suggestions({ doc }) {
  const Card = ui.Card ?? 'div';
  const CardHeader = ui.CardHeader ?? 'div';
  const CardTitle = ui.CardTitle ?? 'strong';
  const CardContent = ui.CardContent ?? 'div';
  const Badge = ui.Badge ?? 'span';

  const words = doc.body.trim().split(/\s+/).filter(Boolean).length;
  const notes = [];
  if (words < 40) {
    notes.push('Short — readers and search engines both want more.');
  }
  if (!/\?/.test(doc.body)) {
    notes.push('No question anywhere. One draws people in.');
  }
  if (/\b(very|really|just)\b/i.test(doc.body)) {
    notes.push('Hedging words present. “Rewrite” removes them.');
  }
  if (notes.length === 0) {
    notes.push('Nothing to complain about. Publish it.');
  }

  return React.createElement(
    Card,
    null,
    React.createElement(
      CardHeader,
      null,
      React.createElement(
        CardTitle,
        null,
        '🤖 Assistant ',
        React.createElement(Badge, { variant: 'default' }, 'Pro'),
      ),
    ),
    React.createElement(
      CardContent,
      null,
      React.createElement(
        'ul',
        { className: 'grid gap-1 text-xs text-muted-foreground' },
        notes.map((note, index) => React.createElement('li', { key: index }, '• ', note)),
      ),
    ),
  );
}

export const AiWritingAssistantPlugin = definePlugin({
  name: '@cms-pro/ai-writing-assistant',
  version: '0.1.0',
  contributes: [
    contribution(
      EditorToolbar,
      { label: '✨ Rewrite', hint: 'Strip hedging words', run: rewrite },
      { id: 'rewrite', order: 100 },
    ),
  ],
  build() {
    // The other shape a plugin can take: a component, in a slot the application
    // offers. Drawn with the host's kit, in the host's theme.
    return {
      components: [{ slot: 'cms.aside', id: 'assistant', Component: Suggestions }],
    };
  },
});

// --- Product → Content Types ------------------------------------------------

export const ProductPlugin = definePlugin({
  name: '@cms-pro/product',
  version: '0.1.0',
  contributes: [
    contribution(
      ContentTypes,
      {
        id: 'product',
        label: 'Product',
        description: 'Something with a price, a SKU and a buy link.',
        template: '## Product\n\nA short pitch, then the details below.\n',
        fields: [
          { name: 'price', placeholder: 'Price, e.g. 24.00' },
          { name: 'sku', placeholder: 'SKU' },
        ],
      },
      { id: 'product', order: 20 },
    ),
  ],
});

// --- Social Publisher → Publish Lifecycle -----------------------------------

export const SocialPublisherPlugin = definePlugin({
  name: '@cms-pro/social-publisher',
  version: '0.1.0',
  contributes: [
    contribution(
      PublishLifecycle,
      {
        label: 'Social',
        // Never returns `ok: false`. A lifecycle that could only veto would
        // have no room for a step that simply *does* something, and one that
        // could only observe would have no room for the SEO validator. Both
        // shapes, one point.
        run: (doc) => ({
          ok: true,
          message: `Announced “${doc.title}” to 3 channels.`,
        }),
      },
      { id: 'social', order: 100 },
    ),
  ],
});
