/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { defineConfig } from 'vite';

const localRequire = createRequire(import.meta.url);
const runtimePackage = localRequire.resolve('@datalayer/agent-runtimes/package.json');
const runtimeRequire = createRequire(runtimePackage);
const packageDirectory = (moduleName: string) => {
  let directory = dirname(runtimeRequire.resolve(moduleName));
  while (!existsSync(join(directory, 'package.json'))) {
    const parent = dirname(directory);
    if (parent === directory) throw new Error(`Could not locate ${moduleName}`);
    directory = parent;
  }
  return directory;
};

export default defineConfig({
  plugins: [
    {
      name: 'raw-css-as-string',
      enforce: 'pre',
      async resolveId(source, importer) {
        if (!source.endsWith('.raw.css') || source.includes('?raw')) return null;
        const resolved = await this.resolve(`${source}?raw`, importer, { skipSelf: true });
        return resolved?.id ?? null;
      },
    },
    {
      name: 'fix-text-query',
      enforce: 'pre',
      async resolveId(source, importer) {
        if (!source.includes('?text')) return null;
        const fixed = source.replace('?text', '?raw');
        const resolved = await this.resolve(fixed, importer, { skipSelf: true });
        return resolved?.id ?? fixed;
      },
    },
    // Some Jupyter widget packages leave Node-only references in otherwise
    // browser-compatible ESM. This mirrors the compatibility pass used by
    // agent-runtimes' own Vite build.
    {
      name: 'patch-node-references-in-bundle',
      generateBundle(_options, bundle) {
        for (const chunk of Object.values(bundle)) {
          if (chunk.type !== 'chunk') continue;
          chunk.code = chunk.code
            .replace(/require\(["']\.\.\/package\.json["']\)\.version/g, '"0.0.0"')
            .replace(/(?<!\.)\b__dirname\b/g, '"/"')
            .replace(/(?<!\.)\b__filename\b/g, '"/index.js"');
        }
      },
    },
  ],
  resolve: {
    alias: [
      {
        find: '~react-toastify/dist/ReactToastify.min.css',
        replacement: join(packageDirectory('react-toastify'), 'dist/ReactToastify.css'),
      },
      {
        find: /^loro-crdt$/,
        replacement: join(packageDirectory('loro-crdt'), 'base64/index.js'),
      },
      { find: /^~(.*)$/, replacement: '$1' },
    ],
    dedupe: ['react', 'react-dom'],
  },
  assetsInclude: ['**/*.wasm', '**/*.raw.css'],
  define: {
    global: 'globalThis',
    __webpack_public_path__: '""',
    'process.env': {},
    __dirname: '"/"',
    __filename: '"/index.js"',
  },
  build: {
    target: 'esnext',
    outDir: resolve(import.meta.dirname, '../share/datalayer/reactor/extensions/cms-astro-ai-agents'),
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/index.tsx'),
      formats: ['es'],
      fileName: () => 'index.js',
    },
  },
});
