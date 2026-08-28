/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The plugin graph, derived rather than drawn.
 *
 * Nothing here asks a plugin to describe its place in the system: every edge
 * comes from something a plugin already had to declare in order to work — a
 * dependency, a required backend plugin, an extension point it offers, a
 * contribution it makes. A graph nobody maintains is a graph that cannot go
 * stale.
 *
 * The derivation deliberately stops at data. It emits nodes and edges and no
 * geometry, colours or component, because where the picture is drawn — echarts,
 * SVG, Graphviz, a terminal — is the host's business and should not drag a
 * charting library into a plugin framework.
 *
 * Both tiers appear in one graph. The frontend platform describes itself; the
 * backend cannot be reached from here, so its half is passed in by a caller
 * that fetched it (`GET /plugins`, `GET /contributions`).
 *
 * @module core/graph
 */

import type { ReactorPlatform } from './reactor';

/** What a node stands for. */
export type PluginGraphNodeKind = 'extension' | 'backend-plugin' | 'extension-point';

/** Which side of the wire a node lives on. */
export type PluginGraphTier = 'frontend' | 'backend';

export type PluginGraphNode = {
  /** Unique across kinds — a point and a plugin may share a name. */
  id: string;
  /** The identifier the plugin is known by. */
  name: string;
  /** What to show a person: the display name, or the identifier. */
  label: string;
  kind: PluginGraphNodeKind;
  /** Absent on a point, which belongs to whoever talks about it. */
  tier?: PluginGraphTier;
  enabled?: boolean;
  lazy?: boolean;
  loaded?: boolean;
  description?: string;
  octicon?: string;
  emoji?: string;
};

/**
 * Why two nodes are connected.
 *
 * `offers-point` and `contributes-to` are the two halves of an extension
 * point: one plugin opens it, others fill it, and neither imports the other.
 */
export type PluginGraphEdgeKind =
  | 'depends-on'
  | 'offers-point'
  | 'contributes-to'
  | 'requires-backend'
  | 'optional-backend'
  | 'requires-frontend'
  | 'optional-frontend';

export type PluginGraphEdge = {
  source: string;
  target: string;
  kind: PluginGraphEdgeKind;
  /** True when the relationship is declared optional. */
  optional?: boolean;
};

export type PluginGraph = {
  nodes: PluginGraphNode[];
  edges: PluginGraphEdge[];
};

/** One backend plugin, shaped as `GET /plugins` reports it. */
export type BackendGraphPlugin = {
  name: string;
  version?: string;
  display_name?: string;
  description?: string;
  octicon?: string;
  emoji?: string;
  enabled?: boolean;
  dependencies?: string[];
  extension_points?: string[];
  frontend_dependencies?: string[];
  optional_frontend_dependencies?: string[];
};

/** One backend contribution, shaped as `GET /contributions` reports it. */
export type BackendGraphContribution = {
  point: string;
  plugin: string;
  id?: string;
};

/**
 * The backend half of the graph, fetched by the caller.
 *
 * Optional in every sense: without it the graph is the frontend's alone, which
 * is the right answer when there is no backend or it cannot be reached.
 */
export type BackendGraphInput = {
  plugins?: BackendGraphPlugin[];
  contributions?: BackendGraphContribution[];
};

export type DescribeGraphOptions = {
  /**
   * Keep plugins that are switched off, or absent altogether.
   *
   * `true` (the default) draws them, which is the right answer for an
   * inventory: a required backend plugin that is not running is the most
   * interesting thing on the graph.
   *
   * `false` shows only what is live. A viewer that reacts to switches wants
   * this — a node left behind with no edges reads as broken rather than as
   * disabled, and the edges have to go with it or they point at nothing.
   */
  includeDisabled?: boolean;
};

/** Node ids are prefixed by kind, so a point and a plugin never collide. */
export const extensionNodeId = (name: string) => `extension:${name}`;
export const backendNodeId = (name: string) => `backend:${name}`;
export const pointNodeId = (id: string) => `point:${id}`;

/**
 * Build the whole plugin graph from what both tiers already declare.
 *
 * @param reactor - the frontend platform, which describes itself
 * @param backend - the backend half, if the caller fetched it
 */
export function describePluginGraph(
  reactor: ReactorPlatform,
  backend: BackendGraphInput = {},
  options: DescribeGraphOptions = {},
): PluginGraph {
  const { includeDisabled = true } = options;
  const nodes = new Map<string, PluginGraphNode>();
  const edges: PluginGraphEdge[] = [];

  /** Points are created by whoever mentions them first, and never twice. */
  function ensurePoint(pointId: string): string {
    const id = pointNodeId(pointId);
    if (!nodes.has(id)) {
      nodes.set(id, { id, name: pointId, label: pointId, kind: 'extension-point' });
    }
    return id;
  }

  // --- The frontend, from the platform itself ------------------------------
  for (const name of reactor.listExtensions()) {
    const metadata = reactor.getMetadata(name);
    if (!metadata) {
      continue;
    }
    const id = extensionNodeId(name);
    nodes.set(id, {
      id,
      name,
      label: metadata.displayName ?? name,
      kind: 'extension',
      tier: 'frontend',
      enabled: reactor.isEnabled(name),
      lazy: metadata.lazy,
      loaded: metadata.loaded,
      description: metadata.description,
      octicon: metadata.octicon,
      emoji: metadata.emoji,
    });

    for (const dependency of reactor.getDependencies(name)) {
      edges.push({ source: id, target: extensionNodeId(dependency), kind: 'depends-on' });
    }
    for (const plugin of metadata.requiredBackendPlugins) {
      edges.push({ source: id, target: backendNodeId(plugin), kind: 'requires-backend' });
    }
    for (const plugin of metadata.optionalBackendPlugins) {
      edges.push({
        source: id,
        target: backendNodeId(plugin),
        kind: 'optional-backend',
        optional: true,
      });
    }
    for (const point of metadata.extensionPoints) {
      edges.push({ source: id, target: ensurePoint(point), kind: 'offers-point' });
    }
  }

  // Contributions are read from the registry rather than from declarations:
  // a contribution made at runtime is as real as one declared up-front, and
  // a disabled extension's contributions are already gone from here.
  for (const { point, contributions } of reactor.describeContributions()) {
    const pointId = ensurePoint(point);
    for (const contribution of contributions) {
      edges.push({
        source: extensionNodeId(contribution.extension),
        target: pointId,
        kind: 'contributes-to',
      });
    }
  }

  // --- The backend, from what the caller fetched ---------------------------
  for (const plugin of backend.plugins ?? []) {
    const id = backendNodeId(plugin.name);
    nodes.set(id, {
      id,
      name: plugin.name,
      label: plugin.display_name || plugin.name,
      kind: 'backend-plugin',
      tier: 'backend',
      enabled: plugin.enabled ?? true,
      description: plugin.description,
      octicon: plugin.octicon,
      emoji: plugin.emoji,
    });

    for (const dependency of plugin.dependencies ?? []) {
      edges.push({ source: id, target: backendNodeId(dependency), kind: 'depends-on' });
    }
    for (const point of plugin.extension_points ?? []) {
      edges.push({ source: id, target: ensurePoint(point), kind: 'offers-point' });
    }
    for (const extension of plugin.frontend_dependencies ?? []) {
      edges.push({
        source: id,
        target: extensionNodeId(extension),
        kind: 'requires-frontend',
      });
    }
    for (const extension of plugin.optional_frontend_dependencies ?? []) {
      edges.push({
        source: id,
        target: extensionNodeId(extension),
        kind: 'optional-frontend',
        optional: true,
      });
    }
  }

  for (const contribution of backend.contributions ?? []) {
    edges.push({
      source: backendNodeId(contribution.plugin),
      target: ensurePoint(contribution.point),
      kind: 'contributes-to',
    });
  }

  // An edge may name a plugin the other tier declared but this one has never
  // heard of — a backend that is not running, a frontend extension nobody
  // loaded. Those are worth seeing, so they become nodes rather than being
  // dropped: a missing dependency is the most interesting thing on a graph.
  for (const edge of edges) {
    for (const endpoint of [edge.source, edge.target]) {
      if (nodes.has(endpoint)) {
        continue;
      }
      const [kind, ...rest] = endpoint.split(':');
      const name = rest.join(':');
      nodes.set(endpoint, {
        id: endpoint,
        name,
        label: name,
        kind: kind === 'backend' ? 'backend-plugin' : 'extension',
        tier: kind === 'backend' ? 'backend' : 'frontend',
        enabled: false,
      });
    }
  }

  if (includeDisabled) {
    return { nodes: [...nodes.values()], edges };
  }

  // Dropping a node means dropping what it was joined by: an edge whose other
  // end has gone points at nothing, and echarts would draw it into empty space.
  const live = new Set(
    [...nodes.values()].filter((node) => node.enabled !== false).map((node) => node.id),
  );
  return {
    nodes: [...nodes.values()].filter((node) => live.has(node.id)),
    edges: edges.filter((edge) => live.has(edge.source) && live.has(edge.target)),
  };
}
