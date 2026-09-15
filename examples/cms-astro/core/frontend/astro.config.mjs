/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import node from '@astrojs/node';
import react from '@astrojs/react';
import { defineConfig } from 'astro/config';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { searchForWorkspaceRoot } from 'vite';

const localRequire = createRequire(import.meta.url);
// Node resolves this to the root workspace link in the monorepo and to the
// frontend-local npm package in a standalone Reactor checkout.
const jupyterLexicalPackage = localRequire.resolve(
  '@datalayer/jupyter-lexical/package.json',
);
const jupyterLexicalDirectory = dirname(jupyterLexicalPackage);
const jupyterLexicalRequire = createRequire(jupyterLexicalPackage);
const dependencyWorkspaceRoot = searchForWorkspaceRoot(
  localRequire.resolve('vite/package.json'),
);
const dependencyDirectory = (
  packageName,
  moduleName = packageName,
  resolver = jupyterLexicalRequire,
) => {
  let directory = dirname(resolver.resolve(moduleName));
  while (!existsSync(join(directory, 'package.json'))) {
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(`Could not locate the package root for ${packageName}`);
    }
    directory = parent;
  }
  return directory;
};
const lexicalPackages = [
  'code',
  'hashtag',
  'link',
  'list',
  'markdown',
  'mark',
  'rich-text',
  'selection',
  'table',
  'utils',
];
const lexicalAliases = lexicalPackages.map(packageName => ({
  find: `@lexical/${packageName}`,
  replacement: dependencyDirectory(`@lexical/${packageName}`),
}));
const toastifyStyles = join(
  dependencyDirectory('react-toastify'),
  'dist/ReactToastify.css',
);
const loroBase64Entry = join(dependencyDirectory('loro-crdt'), 'base64/index.js');

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [react()],
  vite: {
    // JupyterLab styles still use webpack's `~package/path` import convention.
    // Match the compatibility alias used by the Jupyter Vite examples.
    resolve: {
      alias: [
        // Prefer the linked workspace package in the full monorepo. A plain
        // Reactor checkout falls back to the package installed from npm.
        {
          find: '@datalayer/jupyter-lexical',
          replacement: jupyterLexicalDirectory,
        },
        // Resolve every Lexical import from the selected Jupyter Lexical
        // package so a workspace build and a published package cannot mix
        // incompatible Lexical runtimes.
        { find: /^lexical$/, replacement: jupyterLexicalRequire.resolve('lexical') },
        ...lexicalAliases,
        // JupyterLab 4 still names Toastify's pre-v11 minified stylesheet.
        // Toastify v11 ships the same CSS only as ReactToastify.css.
        {
          find: '~react-toastify/dist/ReactToastify.min.css',
          replacement: toastifyStyles,
        },
        // Loro's default ESM condition imports its Wasm module directly. Its
        // self-contained browser entry embeds the bytes and needs no Wasm URL.
        { find: /^loro-crdt$/, replacement: loroBase64Entry },
        { find: /^~(.*)$/, replacement: '$1' },
      ],
      // Published Jupyter packages may carry React 18 while this Astro app
      // uses React 19. Let Vite keep one runtime without aliasing React's
      // CommonJS entry to a raw filesystem path during Astro SSR.
      dedupe: ['react', 'react-dom'],
    },
    // Some transitive Jupyter plugins import their WebAssembly modules as
    // assets. Without this, Vite interprets them as unsupported ESM Wasm.
    assetsInclude: ['**/*.wasm', '**/*.raw.css'],
    server: {
      port: 4321,
      strictPort: true,
      // Workspace-linked packages live above the nested Astro frontend in the
      // monorepo. In a standalone checkout this resolves to the local project.
      fs: {
        allow: [dependencyWorkspaceRoot, jupyterLexicalDirectory],
      },
    },
    define: {
      global: 'globalThis',
      __webpack_public_path__: '""',
      'process.env': {},
    },
    optimizeDeps: {
      esbuildOptions: {
        target: 'esnext',
      },
      include: ['react', 'react-dom'],
    },
  },
});
