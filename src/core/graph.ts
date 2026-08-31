/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The plugin graph, derived rather than drawn.
 *
 * Nothing here asks a plugin to describe its place in the system: every edge
 * comes from something a plugin already had to declare in order to work — the
 * extension that delivered it, a dependency, a required backend plugin, a
 * contribution point it offers, a contribution it makes. A graph nobody
 * maintains is a graph that cannot go stale.
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

/**
 * What a node stands for.
 *
 * `plugin` and `extension` are not two names for one thing: a plugin is the
 * unit that contributes, an extension is the package that delivered it. Both
 * are drawn, because "which extension do I uninstall to lose this view?" is a
 * question a graph should be able to answer.
 */
export type PluginGraphNodeKind =
  | 'plugin'
  | 'extension'
  | 'backend-plugin'
  | 'contribution-point';

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
  /** Whether its phases have run. A plugin can be loaded and still waiting. */
  activated?: boolean;
  /** What it is waiting for, when it is waiting. */
  activationEvents?: string[];
  description?: string;
  octicon?: string;
  emoji?: string;
};

/**
 * Why two nodes are connected.
 *
 * `offers-point` and `contributes-to` are the two halves of a contribution
 * point: one plugin opens it, others fill it, and neither imports the other.
 */
export type PluginGraphEdgeKind =
  | 'depends-on'
  | 'groups'
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
  /** Whether its activation events have fired. Absent means "assume so". */
  activated?: boolean;
  /** The extension that delivered it, when one did. */
  extension?: string;
  activation_events?: string[];
  deactivation_events?: string[];
  dependencies?: string[];
  contribution_points?: string[];
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
export const pluginNodeId = (name: string) => `plugin:${name}`;
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

  /**
   * Extensions are created by whoever mentions one first.
   *
   * The presentation is filled in below from `getExtensionManifest` when the
   * platform knows it; a plugin naming a group nobody registered still gets a
   * node, labelled by its name.
   */
  function ensureExtension(name: string): string {
    const id = extensionNodeId(name);
    if (!nodes.has(id)) {
      nodes.set(id, { id, name, label: name, kind: 'extension', tier: 'frontend' });
    }
    return id;
  }

  /** Points are created by whoever mentions them first, and never twice. */
  function ensurePoint(pointId: string): string {
    const id = pointNodeId(pointId);
    if (!nodes.has(id)) {
      nodes.set(id, { id, name: pointId, label: pointId, kind: 'contribution-point' });
    }
    return id;
  }

  // --- The frontend, from the platform itself ------------------------------
  for (const name of reactor.listPlugins()) {
    const metadata = reactor.getManifest(name);
    if (!metadata) {
      continue;
    }
    const id = pluginNodeId(name);
    nodes.set(id, {
      id,
      name,
      label: metadata.displayName ?? name,
      kind: 'plugin',
      tier: 'frontend',
      enabled: reactor.isEnabled(name),
      lazy: metadata.lazy,
      loaded: metadata.loaded,
      activated: metadata.activated,
      activationEvents: metadata.activationEvents,
      description: metadata.description,
      octicon: metadata.octicon,
      emoji: metadata.emoji,
    });

    // The extension that delivered it. Drawn from the plugin's manifest rather
    // than by walking the extensions, so a plugin whose group was declared but
    // never registered still shows the relationship.
    if (metadata.extension) {
      edges.push({
        source: ensureExtension(metadata.extension),
        target: id,
        kind: 'groups',
      });
    }

    for (const dependency of reactor.getDependencies(name)) {
      edges.push({ source: id, target: pluginNodeId(dependency), kind: 'depends-on' });
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
    for (const point of metadata.contributionPoints) {
      edges.push({ source: id, target: ensurePoint(point), kind: 'offers-point' });
    }
  }

  // The extensions the platform actually knows, so their presentation is the
  // one they declared rather than a bare name. Placed after the plugin pass:
  // a node may already exist from a manifest that named it.
  for (const name of reactor.listExtensions()) {
    const manifest = reactor.getExtensionManifest(name);
    if (!manifest) {
      continue;
    }
    nodes.set(extensionNodeId(name), {
      id: extensionNodeId(name),
      name,
      label: manifest.displayName ?? name,
      kind: 'extension',
      tier: 'frontend',
      description: manifest.description,
      octicon: manifest.octicon,
      emoji: manifest.emoji,
    });
  }

  // Contributions are read from the registry rather than from declarations:
  // a contribution made at runtime is as real as one declared up-front, and
  // a disabled plugin's contributions are already gone from here.
  for (const { point, contributions } of reactor.describeContributions()) {
    const pointId = ensurePoint(point);
    for (const contribution of contributions) {
      edges.push({
        source: pluginNodeId(contribution.plugin),
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
      activated: plugin.activated,
      activationEvents: plugin.activation_events,
      description: plugin.description,
      octicon: plugin.octicon,
      emoji: plugin.emoji,
    });

    // The same grouping the frontend draws, from the same field name on the
    // other tier's manifest. An extension node is shared across tiers on
    // purpose: two packages with one name are one package.
    if (plugin.extension) {
      edges.push({ source: ensureExtension(plugin.extension), target: id, kind: 'groups' });
    }

    for (const dependency of plugin.dependencies ?? []) {
      edges.push({ source: id, target: backendNodeId(dependency), kind: 'depends-on' });
    }
    for (const point of plugin.contribution_points ?? []) {
      edges.push({ source: id, target: ensurePoint(point), kind: 'offers-point' });
    }
    for (const frontend of plugin.frontend_dependencies ?? []) {
      edges.push({
        source: id,
        target: pluginNodeId(frontend),
        kind: 'requires-frontend',
      });
    }
    for (const frontend of plugin.optional_frontend_dependencies ?? []) {
      edges.push({
        source: id,
        target: pluginNodeId(frontend),
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
  // heard of — a backend that is not running, a frontend plugin nobody
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
        kind:
          kind === 'backend'
            ? 'backend-plugin'
            : kind === 'extension'
              ? 'extension'
              : 'plugin',
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
