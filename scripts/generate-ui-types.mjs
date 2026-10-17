#!/usr/bin/env node
/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * TypeScript declarations from the committed reactor.ui wire schema.
 *
 *     node scripts/generate-ui-types.mjs                 # print them
 *     node scripts/generate-ui-types.mjs --out FILE      # write them
 *
 * Uses json-schema-to-typescript, which this repository does not depend on:
 * `npm i --no-save json-schema-to-typescript` first. `src/ui/wire.ts` is
 * written by hand to read well, and the drift test
 * (`src/ui/__tests__/wire.test.ts`) holds it to the schema property by
 * property; this script is for comparing the two when the wire changes.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const SCHEMA = fileURLToPath(new URL('../schema/reactor-ui.v1.schema.json', import.meta.url));

let compile;
try {
  ({ compile } = await import('json-schema-to-typescript'));
} catch {
  console.error(
    'json-schema-to-typescript is not installed: npm i --no-save json-schema-to-typescript',
  );
  process.exit(1);
}

const schema = JSON.parse(await readFile(SCHEMA, 'utf8'));
const banner = [
  '/*',
  ' * Generated from schema/reactor-ui.v1.schema.json by scripts/generate-ui-types.mjs.',
  ' * Edit the pydantic models in reactor/ui/wire.py, not this.',
  ' */',
].join('\n');
const source = await compile(schema, 'UiOpEnvelope', {
  bannerComment: banner,
  additionalProperties: false,
  unreachableDefinitions: true,
});

const at = process.argv.indexOf('--out');
if (at > 0 && process.argv[at + 1]) {
  await writeFile(process.argv[at + 1], source);
  console.error(`Wrote ${process.argv[at + 1]}`);
} else {
  process.stdout.write(source);
}
