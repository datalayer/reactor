/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The commands this application owns.
 *
 * The CMS packages contribute toolbar tools, content types and lifecycle steps;
 * none of them owns the document, so none of them can offer "clear the body".
 * The application does own it, and this is how an application registers
 * commands of its own: as a plugin, through the same registry every other
 * plugin uses.
 *
 * That is the whole point of the registry being in the reactor rather than in
 * the palette — the palette shows these beside the ones a Python package
 * shipped, and neither knows about the other.
 */

import { definePlugin } from '@datalayer/reactor';

import { docStore, STARTING_DOC } from './docStore';

export const CmsCommandsPlugin = definePlugin({
  name: '@cms/app-commands',
  version: '1.0.0',
  displayName: 'CMS commands',
  description: 'The document commands the CMS application itself offers.',
  octicon: 'file',
  emoji: '📄',
  commands: [
    {
      id: 'cms.doc.clearBody',
      name: 'Clear the body',
      description: 'Empty the document, keeping its title and type',
      emoji: '🧹',
      category: 'Document',
      // Nothing to clear is not an error, it is an unavailable command.
      isEnabled: () => docStore.get().body.length > 0,
      execute: () => docStore.update({ body: '' }),
    },
    {
      id: 'cms.doc.reset',
      name: 'Reset the document',
      description: 'Start again from the example document',
      emoji: '↩️',
      category: 'Document',
      execute: () => docStore.set(STARTING_DOC),
    },
    {
      id: 'cms.doc.describe',
      name: 'Describe the document',
      description: 'Its type, and how long the body is',
      emoji: '📄',
      category: 'Document',
      execute: () => {
        const doc = docStore.get();
        // A command may fail, and the palette shows what it says. This one
        // refuses on an empty body to make that visible in the example.
        if (!doc.body.trim()) {
          throw new Error('The document is empty — there is nothing to describe.');
        }
        window.alert(`${doc.contentType}: ${doc.body.length} characters.`);
      },
    },
  ],
});
