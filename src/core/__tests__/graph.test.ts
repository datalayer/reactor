/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import { describe, expect, it } from 'vitest';
import {
  buildReactorFromExtensions,
  contribution,
  defineExtension,
  defineExtensionPoint,
  defineLazyExtension,
  describePluginGraph,
  type PluginGraph,
  type PluginGraphEdgeKind,
} from '../../index';

const RulePoint = defineExtensionPoint<{ title: string }>('app.rule');

const Base = defineExtension({
  name: '@app/base',
  displayName: 'Base',
  extensionPoints: [RulePoint],
  requiredBackendPlugins: ['catalog'],
  optionalBackendPlugins: ['search'],
});

const Extender = defineExtension({
  name: '@app/extender',
  dependencies: [Base],
  contributes: [contribution(RulePoint, { title: 'One' }, { id: 'one' })],
});

/** Edges of one kind, as `source -> target` pairs. */
function edgesOf(graph: PluginGraph, kind: PluginGraphEdgeKind): string[] {
  return graph.edges
    .filter((edge) => edge.kind === kind)
    .map((edge) => `${edge.source} -> ${edge.target}`)
    .sort();
}

describe('describePluginGraph', () => {
  it('derives dependencies, points and contributions from the frontend', () => {
    const reactor = buildReactorFromExtensions([Extender]);
    reactor.start();

    const graph = describePluginGraph(reactor);

    expect(edgesOf(graph, 'depends-on')).toEqual([
      'extension:@app/extender -> extension:@app/base',
    ]);
    // Who opened the point, and who filled it — the two halves that make an
    // extension point, neither importing the other.
    expect(edgesOf(graph, 'offers-point')).toEqual(['extension:@app/base -> point:app.rule']);
    expect(edgesOf(graph, 'contributes-to')).toEqual([
      'extension:@app/extender -> point:app.rule',
    ]);
  });

  it('separates required from optional backend plugins', () => {
    const reactor = buildReactorFromExtensions([Base]);
    reactor.start();

    const graph = describePluginGraph(reactor);

    expect(edgesOf(graph, 'requires-backend')).toEqual([
      'extension:@app/base -> backend:catalog',
    ]);
    expect(edgesOf(graph, 'optional-backend')).toEqual([
      'extension:@app/base -> backend:search',
    ]);
    expect(graph.edges.find((edge) => edge.kind === 'optional-backend')?.optional).toBe(true);
  });

  it('shows a point that has been offered but never contributed to', () => {
    const reactor = buildReactorFromExtensions([Base]);
    reactor.start();

    // The registry knows nothing about an empty point; the declaration is the
    // only reason it can be drawn — and an empty point is worth seeing.
    const graph = describePluginGraph(reactor);
    expect(graph.nodes.map((node) => node.id)).toContain('point:app.rule');
  });

  it('drops a disabled extension’s contributions but keeps the extension', () => {
    const reactor = buildReactorFromExtensions([Extender]);
    reactor.start();
    reactor.disable('@app/extender');

    const graph = describePluginGraph(reactor);

    expect(edgesOf(graph, 'contributes-to')).toEqual([]);
    const node = graph.nodes.find((entry) => entry.id === 'extension:@app/extender');
    expect(node?.enabled).toBe(false);
  });

  it('marks a lazy extension that has not loaded', async () => {
    const reactor = buildReactorFromExtensions([
      defineLazyExtension({
        name: '@app/lazy',
        displayName: 'Lazy',
        load: () => Promise.resolve(defineExtension({ name: '@app/lazy' })),
      }),
    ]);
    reactor.start();

    const before = describePluginGraph(reactor).nodes.find(
      (node) => node.id === 'extension:@app/lazy',
    );
    expect(before).toMatchObject({ label: 'Lazy', lazy: true, loaded: false });

    await reactor.whenReady();
    const after = describePluginGraph(reactor).nodes.find(
      (node) => node.id === 'extension:@app/lazy',
    );
    expect(after?.loaded).toBe(true);
  });

  it('joins the backend half onto the same graph', () => {
    const reactor = buildReactorFromExtensions([Base]);
    reactor.start();

    const graph = describePluginGraph(reactor, {
      plugins: [
        {
          name: 'catalog',
          display_name: 'Catalog',
          enabled: true,
          extension_points: ['app.serverRule'],
        },
        {
          name: 'mood',
          enabled: true,
          dependencies: ['catalog'],
          frontend_dependencies: ['@app/base'],
          optional_frontend_dependencies: ['@app/extender'],
        },
      ],
      contributions: [{ point: 'app.serverRule', plugin: 'mood', id: 'chill' }],
    });

    expect(edgesOf(graph, 'depends-on')).toContain('backend:mood -> backend:catalog');
    expect(edgesOf(graph, 'offers-point')).toContain('backend:catalog -> point:app.serverRule');
    expect(edgesOf(graph, 'contributes-to')).toContain('backend:mood -> point:app.serverRule');
    // The declarations that cross the wire, in the other direction.
    expect(edgesOf(graph, 'requires-frontend')).toEqual(['backend:mood -> extension:@app/base']);
    expect(edgesOf(graph, 'optional-frontend')).toEqual([
      'backend:mood -> extension:@app/extender',
    ]);
    expect(graph.nodes.find((node) => node.id === 'backend:catalog')?.label).toBe('Catalog');
  });

  it('invents a node for something only the other side declared', () => {
    const reactor = buildReactorFromExtensions([Base]);
    reactor.start();

    // Nothing described `catalog` or `search`, but `@app/base` names them. A
    // missing dependency is the most interesting thing on a graph, so it is
    // drawn rather than dropped.
    const graph = describePluginGraph(reactor);
    const catalog = graph.nodes.find((node) => node.id === 'backend:catalog');
    expect(catalog).toMatchObject({ name: 'catalog', kind: 'backend-plugin', enabled: false });
  });

  it('drops disabled plugins and their edges when asked for only what is live', () => {
    const reactor = buildReactorFromExtensions([Extender]);
    reactor.start();
    reactor.disable('@app/extender');

    const shown = describePluginGraph(reactor, {}, { includeDisabled: false });

    // The node goes, and so does the dependency edge that pointed at it —
    // an edge whose end has gone would be drawn into empty space.
    expect(shown.nodes.map((node) => node.id)).not.toContain('extension:@app/extender');
    expect(shown.edges.some((edge) => edge.source === 'extension:@app/extender')).toBe(false);
    // What is still live is still there.
    expect(shown.nodes.map((node) => node.id)).toContain('extension:@app/base');
  });

  it('drops the placeholders for plugins that are not running', () => {
    const reactor = buildReactorFromExtensions([Base]);
    reactor.start();

    // `@app/base` names `catalog` and `search`, which nothing described. They
    // are placeholders, so asking for only what is live removes them.
    const shown = describePluginGraph(reactor, {}, { includeDisabled: false });
    expect(shown.nodes.filter((node) => node.tier === 'backend')).toEqual([]);
    expect(shown.edges.filter((edge) => edge.kind === 'requires-backend')).toEqual([]);
  });

  it('keeps disabled plugins by default', () => {
    const reactor = buildReactorFromExtensions([Extender]);
    reactor.start();
    reactor.disable('@app/extender');

    // The default is an inventory: a plugin that is switched off is still one
    // of the plugins, and a required backend that is missing is worth seeing.
    const graph = describePluginGraph(reactor);
    expect(graph.nodes.map((node) => node.id)).toContain('extension:@app/extender');
  });

  it('has no backend nodes when nothing on either side names one', () => {
    // `Base` names `catalog` and `search`, so it would have placeholders. An
    // extension that asks nothing of the backend has a graph of its own tier.
    const reactor = buildReactorFromExtensions([
      defineExtension({ name: '@app/solo', displayName: 'Solo' }),
    ]);
    reactor.start();

    const graph = describePluginGraph(reactor);
    expect(graph.nodes.filter((node) => node.tier === 'backend')).toEqual([]);
    expect(graph.nodes.map((node) => node.id)).toEqual(['extension:@app/solo']);
  });

  it('keeps the frontend half when the backend cannot be reached', () => {
    const reactor = buildReactorFromExtensions([Extender]);
    reactor.start();

    // What the graph plugin passes when `GET /plugins` failed: the frontend is
    // still a real graph, and the backend plugins it names show as absent.
    const graph = describePluginGraph(reactor, { plugins: [], contributions: [] });

    expect(edgesOf(graph, 'depends-on')).toEqual([
      'extension:@app/extender -> extension:@app/base',
    ]);
    expect(
      graph.nodes.filter((node) => node.tier === 'backend').every((node) => !node.enabled),
    ).toBe(true);
  });
});
