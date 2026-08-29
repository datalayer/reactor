/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Extensions group plugins, and stop there.
 *
 * The temptation with a grouping construct is to let it grow a lifecycle of
 * its own. These tests pin the opposite: an extension is unwrapped into its
 * plugins, the grouping survives only as a name on each manifest and an edge
 * on the graph, and every question the platform answers is still answered
 * about plugins.
 */

import { describe, expect, it } from 'vitest';
import {
  buildReactorFromPlugins,
  contribution,
  defineContributionPoint,
  defineExtension,
  defineLazyPlugin,
  definePlugin,
  describePluginGraph,
} from '../../index';

const Toolbar = defineContributionPoint<{ label: string }>('app.toolbar');

const Editor = definePlugin({
  name: '@app/editor',
  displayName: 'Editor',
  contributionPoints: [Toolbar],
});

const EditorToolbar = definePlugin({
  name: '@app/editor-toolbar',
  displayName: 'Editor toolbar',
  dependencies: [Editor],
  contributes: [contribution(Toolbar, { label: 'Run' })],
});

const NotebookExtension = defineExtension({
  name: '@app/notebooks',
  displayName: 'Notebooks',
  description: 'The editor and its toolbar, installed as one thing.',
  emoji: '📓',
  plugins: [Editor, EditorToolbar],
});

describe('defineExtension', () => {
  it('refuses an extension with no plugins', () => {
    expect(() => defineExtension({ name: '@app/empty', plugins: [] })).toThrow(
      /at least one plugin/,
    );
  });

  it('refuses an extension with no name', () => {
    expect(() => defineExtension({ name: '', plugins: [Editor] })).toThrow(/needs a name/);
  });
});

describe('a platform built from an extension', () => {
  it('registers the plugins it groups, not the extension', () => {
    const reactor = buildReactorFromPlugins([NotebookExtension]);
    reactor.start();

    expect(reactor.listPlugins()).toEqual(['@app/editor', '@app/editor-toolbar']);
    // The extension is not a plugin, and must not answer as one.
    expect(reactor.hasPlugin('@app/notebooks')).toBe(false);
  });

  it('records the grouping on each plugin manifest', () => {
    const reactor = buildReactorFromPlugins([NotebookExtension]);
    reactor.start();

    expect(reactor.getManifest('@app/editor')?.extension).toBe('@app/notebooks');
    expect(reactor.getManifest('@app/editor-toolbar')?.extension).toBe('@app/notebooks');
  });

  it('lists the extension and what it delivered', () => {
    const reactor = buildReactorFromPlugins([NotebookExtension]);
    reactor.start();

    expect(reactor.listExtensions()).toEqual(['@app/notebooks']);
    expect(reactor.getExtensionManifest('@app/notebooks')).toMatchObject({
      displayName: 'Notebooks',
      emoji: '📓',
      plugins: ['@app/editor', '@app/editor-toolbar'],
    });
  });

  it('leaves a loose plugin ungrouped', () => {
    const Loose = definePlugin({ name: '@app/loose' });
    const reactor = buildReactorFromPlugins([NotebookExtension, Loose]);
    reactor.start();

    expect(reactor.getManifest('@app/loose')?.extension).toBeUndefined();
    expect(reactor.getExtensionManifest('@app/notebooks')?.plugins).not.toContain(
      '@app/loose',
    );
  });

  it('does not group a plugin that merely arrived as a dependency', () => {
    // `@app/editor` is grouped because the extension names it. A dependency
    // pulled in from outside the extension is not part of that package, and
    // saying it was would be a lie on the graph.
    const Outside = definePlugin({ name: '@app/outside' });
    const Grouped = definePlugin({ name: '@app/grouped', dependencies: [Outside] });
    const reactor = buildReactorFromPlugins([
      defineExtension({ name: '@app/group', plugins: [Grouped] }),
    ]);
    reactor.start();

    expect(reactor.getManifest('@app/grouped')?.extension).toBe('@app/group');
    expect(reactor.getManifest('@app/outside')?.extension).toBeUndefined();
  });

  it('accepts lazy plugins as members', async () => {
    const reactor = buildReactorFromPlugins([
      defineExtension({
        name: '@app/lazy-group',
        plugins: [
          defineLazyPlugin({
            name: '@app/lazy-member',
            load: async () => ({ default: definePlugin({ name: '@app/lazy-member' }) }),
          }),
        ],
      }),
    ]);
    reactor.start();
    await reactor.whenReady();

    expect(reactor.getManifest('@app/lazy-member')).toMatchObject({
      extension: '@app/lazy-group',
      loaded: true,
    });
  });

  it('is still switched off one plugin at a time', () => {
    const reactor = buildReactorFromPlugins([NotebookExtension]);
    reactor.start();
    expect(reactor.getContributions(Toolbar)).toHaveLength(1);

    reactor.disable('@app/editor-toolbar');

    expect(reactor.getContributions(Toolbar)).toEqual([]);
    // Its sibling is untouched: grouping is about delivery, not lifecycle.
    expect(reactor.isEnabled('@app/editor')).toBe(true);
  });
});

describe('the graph', () => {
  it('draws the extension and its edge to each plugin it delivered', () => {
    const reactor = buildReactorFromPlugins([NotebookExtension]);
    reactor.start();
    const graph = describePluginGraph(reactor);

    const extension = graph.nodes.find((node) => node.id === 'extension:@app/notebooks');
    expect(extension).toMatchObject({ kind: 'extension', label: 'Notebooks' });

    expect(
      graph.edges
        .filter((edge) => edge.kind === 'groups')
        .map((edge) => `${edge.source} -> ${edge.target}`),
    ).toEqual([
      'extension:@app/notebooks -> plugin:@app/editor',
      'extension:@app/notebooks -> plugin:@app/editor-toolbar',
    ]);
  });

  it('keeps the two halves of a contribution point pointing at plugins', () => {
    const reactor = buildReactorFromPlugins([NotebookExtension]);
    reactor.start();
    const graph = describePluginGraph(reactor);

    expect(
      graph.edges
        .filter((edge) => edge.kind === 'offers-point' || edge.kind === 'contributes-to')
        .map((edge) => `${edge.source} -> ${edge.target}`),
    ).toEqual([
      'plugin:@app/editor -> point:app.toolbar',
      'plugin:@app/editor-toolbar -> point:app.toolbar',
    ]);
  });
});

describe('the backend half of the graph', () => {
  it('draws its grouping from the same field name', () => {
    const reactor = buildReactorFromPlugins([Editor]);
    reactor.start();
    const graph = describePluginGraph(reactor, {
      plugins: [
        {
          name: 'catalog',
          display_name: 'Catalog',
          extension: 'shop',
          activated: false,
          activation_events: ['onCommand:browse'],
        },
      ],
    });

    expect(
      graph.edges
        .filter(edge => edge.kind === 'groups')
        .map(edge => `${edge.source} -> ${edge.target}`),
    ).toContain('extension:shop -> backend:catalog');
    // The state a manifest cannot carry travels with it, so a held backend
    // plugin is not drawn as a broken one.
    expect(graph.nodes.find(node => node.id === 'backend:catalog')).toMatchObject({
      activated: false,
      activationEvents: ['onCommand:browse'],
    });
  });
});
