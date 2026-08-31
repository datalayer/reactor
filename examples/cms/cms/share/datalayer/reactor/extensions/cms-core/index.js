/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The Core extension's browser half: three plugins, one module.
 *
 * Un-built, like every frontend half in this repository — a plain ES module the
 * host imports from a URL the server gave it. It borrows React and the runtime
 * from the host rather than importing them, because a module fetched at runtime
 * is not in the host's bundle.
 *
 * Read what these plugins *are*: three sets of plain records. Not one of them
 * imports a design system, mentions a CSS class, or knows what the CMS looks
 * like. They say what they offer; the application decides how to draw it. That
 * is why the same plugins would work in a host built with a different kit —
 * which is the claim `examples/music` makes with Primer and this one makes with
 * shadcn/ui.
 */

const shared = globalThis.__DATALAYER_REACTOR__?.shared;

if (!shared) {
  throw new Error('@cms/core: the host published no shared modules.');
}

const { definePlugin, defineContributionPoint, contribution } = shared['@datalayer/reactor'];

/**
 * The points, by id.
 *
 * Declared here rather than imported: this module cannot import the
 * application, and does not need to. `defineContributionPoint` keys on the id,
 * so this handle and the application's are the same point — which is exactly
 * how a plugin is written against an application it has never seen.
 */
const EditorToolbar = defineContributionPoint('cms.editorToolbar');
const ContentTypes = defineContributionPoint('cms.contentType');
const PublishLifecycle = defineContributionPoint('cms.publishLifecycle');

// --- Markdown Tools → Editor Toolbar ---------------------------------------

const heading = (body) => `## Section\n\n${body}`;
const bold = (body) => body.replace(/\b(\w+)\b(?![^]*\*\*)/, '**$1**');
const link = (body) => `${body.trimEnd()}\n\n[Read more](https://example.com)\n`;

export const MarkdownToolsPlugin = definePlugin({
  name: '@cms/markdown-tools',
  version: '0.1.0',
  contributes: [
    contribution(
      EditorToolbar,
      { label: 'Heading', hint: 'Start a section', run: heading },
      { id: 'heading', order: 0 },
    ),
    contribution(
      EditorToolbar,
      { label: 'Bold', hint: 'Embolden the first word', run: bold },
      { id: 'bold', order: 1 },
    ),
    contribution(
      EditorToolbar,
      { label: 'Link', hint: 'Append a link', run: link },
      { id: 'link', order: 2 },
    ),
  ],
});

// --- Gallery → Content Types ------------------------------------------------

export const GalleryPlugin = definePlugin({
  name: '@cms/gallery',
  version: '0.1.0',
  contributes: [
    contribution(
      ContentTypes,
      {
        id: 'gallery',
        label: 'Gallery',
        description: 'A set of images with captions.',
        template: '## Gallery\n\n![A caption](/images/one.jpg)\n',
        fields: [
          { name: 'caption', placeholder: 'Caption' },
          { name: 'alt', placeholder: 'Alt text' },
        ],
      },
      { id: 'gallery', order: 10 },
    ),
  ],
});

// --- SEO Validator → Publish Lifecycle --------------------------------------

export const SeoValidatorPlugin = definePlugin({
  name: '@cms/seo-validator',
  version: '0.1.0',
  contributes: [
    contribution(
      PublishLifecycle,
      {
        label: 'SEO',
        run: (doc) => {
          if (doc.body.length < 80) {
            return { ok: false, message: 'Body is too short to rank for anything.' };
          }
          if (!/^#{1,3} /m.test(doc.body)) {
            return { ok: false, message: 'No heading — add one before publishing.' };
          }
          return { ok: true, message: 'Has a heading and enough prose.' };
        },
      },
      { id: 'seo', order: 0 },
    ),
  ],
});
