/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * What a plugin says of itself beyond its presentation — its package, tags,
 * configuration schema, declared slots, contributions and commands, and its
 * host's metadata — reaches the manifest, before and after a lazy module
 * lands.
 */

import { describe, expect, it } from 'vitest';
import {
  buildReactorFromPlugins,
  contribution,
  defineContributionPoint,
  defineLazyPlugin,
  definePlugin,
} from '../../index';

const Toolbar = defineContributionPoint<{ title: string }>('app.toolbar');
const Menu = defineContributionPoint<{ title: string }>('app.menu');

const SCHEMA = {
  type: 'object',
  properties: { size: { type: 'number', title: 'Size', default: 3 } },
};

describe('the manifest describes a plugin', () => {
  it('carries its package, tags, settings schema, declarations and metadata', () => {
    const plugin = definePlugin<{ size: number }>({
      name: '@test/described',
      package: '@test/described-ui',
      tags: ['chat', 'demo'],
      config: { size: 3 },
      configSchema: SCHEMA,
      declares: {
        slots: ['app.header'],
        contributesTo: ['app.menu'],
        commands: ['describe'],
      },
      metadata: { ui: { placements: ['header'], renderers: ['a2ui'] } },
      contributes: [contribution(Toolbar, { title: 'Hello' })],
      commands: [{ id: 'hello', name: 'Hello', execute: () => undefined }],
      register: ({ contribute }) => contribute(Menu, { title: 'Later' }),
    });
    const reactor = buildReactorFromPlugins([plugin]);
    reactor.start();
    const manifest = reactor.getManifest('@test/described');
    expect(manifest?.package).toBe('@test/described-ui');
    expect(manifest?.tags).toEqual(['chat', 'demo']);
    expect(manifest?.configSchema).toEqual(SCHEMA);
    expect(manifest?.metadata).toEqual({
      ui: { placements: ['header'], renderers: ['a2ui'] },
    });
    expect(manifest?.slots).toEqual(['app.header']);
    expect([...(manifest?.contributesTo ?? [])].sort()).toEqual(['app.menu', 'app.toolbar']);
    expect([...(manifest?.commands ?? [])].sort()).toEqual(['describe', 'hello']);
  });

  it('says nothing it was not told: empty lists, no package, no metadata', () => {
    const reactor = buildReactorFromPlugins([definePlugin({ name: '@test/bare' })]);
    reactor.start();
    const manifest = reactor.getManifest('@test/bare');
    expect(manifest?.package).toBeUndefined();
    expect(manifest?.configSchema).toBeUndefined();
    expect(manifest?.metadata).toBeUndefined();
    expect(manifest?.tags).toEqual([]);
    expect(manifest?.slots).toEqual([]);
    expect(manifest?.commands).toEqual([]);
    expect(manifest?.contributesTo).toEqual([]);
  });

  it('describes a lazy plugin before its module lands, and keeps what the module says after', async () => {
    let release!: () => void;
    const landed = new Promise<void>((resolve) => {
      release = resolve;
    });
    const Lazy = defineLazyPlugin({
      name: '@test/lazy-described',
      package: '@test/lazy-ui',
      tags: ['lazy'],
      declares: { slots: ['app.side'] },
      metadata: { ui: { placements: ['left'] } },
      load: async () => {
        await landed;
        return definePlugin({
          name: '@test/lazy-described',
          metadata: { ui: { placements: ['right'] } },
        });
      },
    });
    const reactor = buildReactorFromPlugins([Lazy]);
    reactor.start();
    const before = reactor.getManifest('@test/lazy-described');
    expect(before?.loaded).toBe(false);
    expect(before?.package).toBe('@test/lazy-ui');
    expect(before?.tags).toEqual(['lazy']);
    expect(before?.slots).toEqual(['app.side']);
    expect(before?.metadata).toEqual({ ui: { placements: ['left'] } });
    release();
    await reactor.whenReady();
    const after = reactor.getManifest('@test/lazy-described');
    expect(after?.loaded).toBe(true);
    expect(after?.package).toBe('@test/lazy-ui');
    expect(after?.slots).toEqual(['app.side']);
    expect(after?.metadata).toEqual({ ui: { placements: ['right'] } });
  });
});
