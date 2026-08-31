/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Build every package under `plugins/`.
 *
 * Discovered rather than listed, so adding a plugin is adding a folder — the
 * build does not have to be edited too, and a plugin cannot be forgotten by
 * whoever adds it.
 *
 * Run through `npm run build:plugins`, and as part of `npm run build`.
 *
 * Usage:
 *   node scripts/build-plugins.mjs [script]   # defaults to "build"
 */

import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pluginsDir = join(root, 'plugins');
const script = process.argv[2] ?? 'build';

if (!existsSync(pluginsDir)) {
  console.log('[plugins] no plugins/ directory — nothing to build');
  process.exit(0);
}

const packages = readdirSync(pluginsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(pluginsDir, entry.name))
  .filter((dir) => existsSync(join(dir, 'package.json')));

if (packages.length === 0) {
  console.log('[plugins] no packages found');
  process.exit(0);
}

let failed = 0;
for (const dir of packages) {
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  if (!manifest.scripts?.[script]) {
    console.log(`[plugins] ${manifest.name}: no "${script}" script, skipped`);
    continue;
  }
  console.log(`[plugins] ${manifest.name}: npm run ${script}`);
  const result = spawnSync('npm', ['run', script], {
    cwd: dir,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  // Keep going, then fail once at the end: one broken plugin should not hide
  // whether the others build.
  if (result.status !== 0) {
    console.error(`[plugins] ${manifest.name}: FAILED`);
    failed += 1;
  }
}

if (failed > 0) {
  console.error(`[plugins] ${failed} package(s) failed`);
  process.exit(1);
}
console.log(`[plugins] ${packages.length} package(s) done`);
