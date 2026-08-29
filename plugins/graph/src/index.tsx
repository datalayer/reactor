/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The plugin graph, drawn.
 *
 * The shape of the graph is not this plugin's business: `describePluginGraph`
 * in the reactor derives it from what plugins already declare, and hands back
 * nodes and edges with no geometry or colour on them. This plugin does the
 * other half — turn that into an echarts force layout, in the host's own
 * theme.
 *
 * That split is why the derivation could stay in the framework: a plugin
 * framework has no business depending on a charting library, and a chart has
 * no business knowing what a contribution is.
 *
 * The backend half is fetched rather than derived, because it lives in another
 * process: `GET /plugins` says who exists and what they depend on,
 * `GET /contributions` says who fills whose contribution points.
 *
 * @module graph-plugin
 */

import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import ReactECharts from 'echarts-for-react';
import { Spinner, Text, useTheme } from '@primer/react';
import { Box } from '@datalayer/primer-addons';
import {
  definePlugin,
  describePluginGraph,
  type BackendGraphContribution,
  type BackendGraphPlugin,
  type PluginGraph,
  type PluginGraphEdgeKind,
  type PluginGraphNode,
  type PluginGraphNodeKind,
} from '@datalayer/reactor';
import { useReactorPlatform } from '@datalayer/reactor/react';

/** What the backend answers about itself, or nothing if it cannot be reached. */
type BackendHalf = {
  plugins: BackendGraphPlugin[];
  contributions: BackendGraphContribution[];
  error: string | null;
  loading: boolean;
};

/**
 * The backend's half of the graph.
 *
 * Two ways in, because hosts differ. A host that already tracks its backend
 * plugins — most do, if they offer a way to switch them on and off — passes
 * them in, and the graph follows that state exactly rather than keeping a
 * second copy that could disagree. A host that tracks nothing passes only a
 * URL and this fetches the list itself.
 *
 * Contributions are always fetched, since nothing else is likely to hold them,
 * and re-fetched whenever the plugin list changes: disabling a backend plugin
 * withdraws its contributions server-side, which is exactly what must show.
 */
function useBackendHalf(
  baseUrl: string | undefined,
  suppliedPlugins: BackendGraphPlugin[] | undefined,
): BackendHalf {
  const [fetchedPlugins, setFetchedPlugins] = useState<BackendGraphPlugin[]>([]);
  const [contributions, setContributions] = useState<BackendGraphContribution[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(baseUrl));

  const hostSupplies = suppliedPlugins !== undefined;
  const plugins = hostSupplies ? suppliedPlugins : fetchedPlugins;

  // The toggles that must invalidate what was fetched, as one comparable
  // value: which plugins exist, and which are on.
  const pluginSignature = hostSupplies
    ? suppliedPlugins.map((plugin) => `${plugin.name}:${plugin.enabled ? 1 : 0}`).join(',')
    : '';

  useEffect(() => {
    if (!baseUrl) {
      // No backend to ask: the frontend half is still a real graph.
      setLoading(false);
      return undefined;
    }
    let active = true;
    setLoading(true);

    const fetchJson = async (path: string) => {
      const response = await fetch(`${baseUrl}${path}`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.json();
    };

    const wanted: Promise<unknown>[] = [fetchJson('/contributions')];
    if (!hostSupplies) {
      wanted.push(fetchJson('/plugins'));
    }

    Promise.all(wanted)
      .then(([described, maybePlugins]) => {
        if (!active) {
          return;
        }
        // `/contributions` groups by point; the graph wants them flat.
        setContributions(
          (described as { point: string; contributions: { plugin: string; id: string }[] }[])
            .flatMap((entry) =>
              entry.contributions.map((contribution) => ({
                point: entry.point,
                plugin: contribution.plugin,
                id: contribution.id,
              })),
            ),
        );
        if (!hostSupplies) {
          setFetchedPlugins((maybePlugins ?? []) as BackendGraphPlugin[]);
        }
        setError(null);
      })
      .catch((caught) => {
        if (active) {
          setContributions([]);
          setError(caught instanceof Error ? caught.message : 'unknown error');
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [baseUrl, hostSupplies, pluginSignature]);

  return { plugins, contributions, error, loading };
}

/** Read a Primer colour token, so the chart follows the chosen theme. */
function cssColor(token: string, fallback: string): string {
  if (typeof window === 'undefined') {
    return fallback;
  }
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(token)
    .trim();
  return value || fallback;
}

/** How each kind of relationship is drawn, and what it is called. */
const EDGE_STYLES: Record<
  PluginGraphEdgeKind,
  { label: string; token: string; fallback: string; dashed?: boolean }
> = {
  'depends-on': { label: 'depends on', token: '--fgColor-muted', fallback: '#8b949e' },
  groups: { label: 'delivers', token: '--fgColor-sponsors', fallback: '#db61a2' },
  'offers-point': { label: 'offers', token: '--fgColor-done', fallback: '#a371f7' },
  'contributes-to': { label: 'contributes', token: '--fgColor-success', fallback: '#3fb950' },
  'requires-backend': { label: 'requires', token: '--fgColor-accent', fallback: '#2f81f7' },
  'optional-backend': {
    label: 'optional',
    token: '--fgColor-attention',
    fallback: '#d29922',
    dashed: true,
  },
  'requires-frontend': { label: 'requires', token: '--fgColor-accent', fallback: '#2f81f7' },
  'optional-frontend': {
    label: 'optional',
    token: '--fgColor-attention',
    fallback: '#d29922',
    dashed: true,
  },
};

/** The kinds of node, as echarts categories — which is also the legend. */
const CATEGORIES = [
  { key: 'extension', name: 'Extension', token: '--fgColor-sponsors', fallback: '#db61a2' },
  { key: 'plugin', name: 'Frontend plugin', token: '--fgColor-accent', fallback: '#2f81f7' },
  { key: 'backend-plugin', name: 'Backend plugin', token: '--fgColor-severe', fallback: '#db6d28' },
  {
    key: 'contribution-point',
    name: 'Contribution point',
    token: '--fgColor-done',
    fallback: '#a371f7',
  },
] as const;

/**
 * Which column a node belongs in: what delivers, what needs, what is offered,
 * what serves.
 *
 * Extensions get a column of their own on the far left rather than sharing the
 * plugin column. They are a different kind of thing — a package, not a
 * participant — and mixing them in would make the plugin column read as a flat
 * list of peers, which is exactly the confusion the grouping exists to remove.
 */
const COLUMN_OF: Record<PluginGraphNodeKind, number> = {
  extension: 0,
  plugin: 1,
  'contribution-point': 2,
  'backend-plugin': 3,
};

const COLUMN_TITLES = [
  'Extensions',
  'Frontend (TypeScript)',
  'Contribution points',
  'Backend (Python)',
];

/** Horizontal spacing between columns, in the chart's own units. */
const COLUMN_GAP = 340;
/** Vertical spacing between nodes in a column. */
const ROW_GAP = 92;

type PositionedNode = PluginGraphNode & { x: number; y: number };

/**
 * Place every node on a grid, rather than letting a force simulation settle.
 *
 * A force layout is the wrong tool here twice over: it is non-deterministic,
 * so the same system looks different on every visit, and it optimises for
 * even spacing rather than for the one structure a reader actually wants —
 * which tier a plugin is on, and which way a dependency points.
 *
 * So: four columns, extensions and the plugins they deliver on the left,
 * backend on the right, and the contribution points between them, because a
 * point is exactly the place where the two tiers meet. Within a column, nodes
 * are ordered by dependency depth, so what depends on something sits below it
 * and the arrows mostly run one way.
 */
function layoutGraph(graph: PluginGraph): PositionedNode[] {
  const dependencies = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.kind !== 'depends-on') {
      continue;
    }
    const existing = dependencies.get(edge.source);
    if (existing) {
      existing.push(edge.target);
    } else {
      dependencies.set(edge.source, [edge.target]);
    }
  }

  const depths = new Map<string, number>();
  function depthOf(id: string, visiting: Set<string>): number {
    const known = depths.get(id);
    if (known !== undefined) {
      return known;
    }
    // A cycle has no depth to speak of; the reactor rejects one anyway, and
    // guessing zero here is better than recurring forever.
    if (visiting.has(id)) {
      return 0;
    }
    visiting.add(id);
    const deps = dependencies.get(id) ?? [];
    const depth = deps.length === 0 ? 0 : Math.max(...deps.map((dep) => depthOf(dep, visiting))) + 1;
    visiting.delete(id);
    depths.set(id, depth);
    return depth;
  }

  // Sized from the titles rather than written out, so adding a column is one
  // edit: a literal `[[], [], []]` here silently dropped every extension node
  // into `undefined.push` the moment a fourth column existed.
  const columns: PluginGraphNode[][] = COLUMN_TITLES.map(() => []);
  for (const node of graph.nodes) {
    columns[COLUMN_OF[node.kind]].push(node);
  }

  const tallest = Math.max(...columns.map((column) => column.length), 1);
  const positioned: PositionedNode[] = [];

  columns.forEach((column, columnIndex) => {
    column.sort((a, b) => {
      const byDepth = depthOf(a.id, new Set()) - depthOf(b.id, new Set());
      return byDepth !== 0 ? byDepth : a.label.localeCompare(b.label);
    });
    // Each column is centred against the tallest, so short columns sit beside
    // the middle of long ones rather than all hugging the top.
    const offset = ((tallest - column.length) * ROW_GAP) / 2;
    column.forEach((node, rowIndex) => {
      positioned.push({
        ...node,
        x: columnIndex * COLUMN_GAP,
        y: offset + rowIndex * ROW_GAP,
      });
    });
  });

  return positioned;
}

/** The edge kinds worth spelling out, and how to say them. */
const EDGE_LEGEND: { kind: PluginGraphEdgeKind; description: string; color: string }[] = [
  { kind: 'depends-on', description: 'depends on', color: 'fg.muted' },
  { kind: 'groups', description: 'delivers a plugin', color: 'sponsors.fg' },
  { kind: 'offers-point', description: 'offers a contribution point', color: 'done.fg' },
  { kind: 'contributes-to', description: 'contributes to a point', color: 'success.fg' },
  { kind: 'requires-backend', description: 'requires across the wire', color: 'accent.fg' },
  { kind: 'optional-backend', description: 'uses if available', color: 'attention.fg' },
];

export type PluginGraphViewProps = {
  /**
   * Where the reactor's management API lives, e.g. `http://localhost:8799`.
   *
   * Omit it for a frontend-only graph: without a backend to ask, the platform
   * in this browser is the whole system worth drawing.
   */
  backendUrl?: string;
  /**
   * The backend plugins, if the host already tracks them.
   *
   * Pass this when something else in the application owns that state — a
   * plugin manager, a settings panel — so the graph and the switches can never
   * disagree. Left out, the graph fetches the list from `backendUrl` itself.
   */
  backendPlugins?: BackendGraphPlugin[];
  /**
   * Draw plugins that are switched off, or absent. Defaults to `false`: a node
   * with no edges reads as broken rather than as disabled.
   */
  includeDisabled?: boolean;
  /** Chart height. */
  height?: number | string;
};

/**
 * The plugin graph as a force-directed chart.
 *
 * Reusable on purpose: it takes nothing from this example but the backend URL,
 * and reads everything else from the reactor it is rendered inside.
 */
export function PluginGraphView({
  backendUrl,
  backendPlugins,
  includeDisabled = false,
  height = 680,
}: PluginGraphViewProps) {
  const reactor = useReactorPlatform();
  const backend = useBackendHalf(backendUrl, backendPlugins);
  // `useTheme` is what makes the chart re-read the CSS tokens below when the
  // reader changes theme — the chart is drawn once and would not otherwise.
  const { resolvedColorMode, colorScheme } = useTheme();

  // Without this the graph is drawn once and never again: enabling or
  // disabling a frontend plugin changes the platform, not this component's
  // props, so nothing here would know to recompute.
  const revision = useSyncExternalStore(reactor.subscribe, () => reactor.getRevision());

  const graph: PluginGraph = useMemo(
    () =>
      describePluginGraph(
        reactor,
        { plugins: backend.plugins, contributions: backend.contributions },
        { includeDisabled },
      ),
    // `revision` is the snapshot: the graph is rebuilt on every call, so it
    // cannot be compared by identity.
    [reactor, revision, backend.plugins, backend.contributions, includeDisabled],
  );

  /**
   * Keep the canvas the size of its box.
   *
   * `echarts-for-react` only listens to *window* resizes. A container that
   * changes width on its own — a sidebar opening, a two-column layout
   * collapsing to one — leaves the canvas at its old backing size, and the
   * browser stretches it to fit: every node becomes an ellipse and every
   * label leans. Observing the box and calling `resize()` is what keeps a
   * circle a circle at any width.
   */
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReactECharts | null>(null);

  useEffect(() => {
    const node = containerRef.current;
    // Absent in jsdom and in older browsers; without it the chart is simply
    // as correct as it was before, rather than broken.
    if (!node || typeof ResizeObserver === 'undefined') {
      return;
    }
    const observer = new ResizeObserver(() => {
      chartRef.current?.getEchartsInstance().resize();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const option = useMemo(() => {
    const muted = cssColor('--fgColor-muted', '#8b949e');
    const onEmphasis = cssColor('--fgColor-onEmphasis', '#ffffff');
    const categoryColor = CATEGORIES.map((category) =>
      cssColor(category.token, category.fallback),
    );

    const fg = cssColor('--fgColor-default', '#e6edf3');

    const nodes = layoutGraph(graph).map((node) => {
      const categoryIndex = CATEGORIES.findIndex((entry) => entry.key === node.kind);
      const pending = node.lazy && !node.loaded;
      // A point is smaller than a plugin: it is a meeting place, not a thing
      // that runs.
      const size = node.kind === 'contribution-point' ? 30 : 46;
      return {
        id: node.id,
        name: node.label,
        value: node.name,
        x: node.x,
        y: node.y,
        category: categoryIndex < 0 ? 0 : categoryIndex,
        symbolSize: size,
        // A disabled plugin is not here at all; only a lazy one still loading
        // is drawn faintly, because it is on its way rather than switched off.
        itemStyle: {
          opacity: pending ? 0.6 : 1,
          borderColor: pending ? cssColor('--fgColor-attention', '#d29922') : undefined,
          borderWidth: pending ? 2 : 0,
          borderType: 'dashed' as const,
        },
        label: {
          show: true,
          // Beside the node rather than under it: columns have room to the
          // side, and a label under a node collides with the row below.
          position: node.kind === 'backend-plugin' ? ('right' as const) : ('left' as const),
          distance: 12,
          // Two lines, because four plugins here share a display name across
          // the two tiers. Hiding one would hide a real relationship, so both
          // are shown and the identifier is what tells them apart.
          formatter: () =>
            `{title|${node.emoji ? `${node.emoji} ` : ''}${node.label}}\n{id|${node.name}}`,
          rich: {
            title: { fontSize: 12, fontWeight: 'bold' as const, color: fg, lineHeight: 16 },
            id: { fontSize: 10, color: muted, lineHeight: 14 },
          },
        },
        tooltip: {
          formatter: () => {
            const lines = [
              `<strong>${node.emoji ? `${node.emoji} ` : ''}${node.label}</strong>`,
              `<code>${node.name}</code>`,
              node.kind === 'contribution-point'
                ? 'Contribution point'
                : node.kind === 'extension'
                  ? 'Extension'
                : node.tier === 'backend'
                  ? 'Backend plugin (Python)'
                  : 'Frontend plugin (TypeScript)',
            ];
            if (node.description) {
              lines.push('', node.description);
            }
            if (node.enabled === false) {
              lines.push('', '<em>disabled</em>');
            }
            if (pending) {
              lines.push('', '<em>lazy — not loaded yet</em>');
            }
            return lines.join('<br/>');
          },
        },
      };
    });

    const links = graph.edges.map((edge) => {
      const style = EDGE_STYLES[edge.kind];
      const color = cssColor(style.token, style.fallback);
      return {
        source: edge.source,
        target: edge.target,
        // Named on hover rather than always. Twenty-seven labels at once is
        // not a graph anyone can read; the colour and dash carry the kind, the
        // legend below spells them out, and hovering says it in words.
        label: {
          show: false,
          formatter: style.label,
          fontSize: 10,
          color: fg,
        },
        emphasis: { label: { show: true } },
        lineStyle: {
          color,
          width: edge.optional ? 1 : 1.8,
          type: style.dashed ? ('dashed' as const) : ('solid' as const),
          opacity: edge.optional ? 0.7 : 0.9,
          curveness: 0.12,
        },
      };
    });

    return {
      backgroundColor: 'transparent',
      // Nodes are matched by id between updates, so switching a plugin off
      // slides the survivors into their new rows instead of redrawing the
      // whole picture in place.
      animationDurationUpdate: 600,
      animationEasingUpdate: 'cubicInOut' as const,
      tooltip: { confine: true, backgroundColor: cssColor('--bgColor-default', '#0d1117') },
      legend: [
        {
          data: CATEGORIES.map((category) => category.name),
          textStyle: { color: muted },
          top: 0,
          // Circles, to match the nodes. Echarts draws legend markers as
          // rounded rectangles by default, so the key at the top disagreed
          // with the picture under it about what a plugin looks like.
          icon: 'circle',
        },
      ],
      graphic: COLUMN_TITLES.map((title, index) => ({
        type: 'text' as const,
        left: `${12 + index * 38}%`,
        top: 32,
        style: {
          text: title,
          fill: muted,
          fontSize: 11,
          fontWeight: 'bold' as const,
        },
      })),
      series: [
        {
          type: 'graph',
          // Circles, stated rather than inherited. It is the echarts default
          // for a graph today, but the shape of a node is a decision this
          // chart makes — a plugin is a thing, not a box — and leaving it to a
          // library default puts that decision somewhere nobody can see it.
          symbol: 'circle' as const,
          // Placed, not simulated — see `layoutGraph`.
          layout: 'none' as const,
          roam: true,
          draggable: true,
          // Room for the two-line labels that hang outside the outer columns.
          // Too little and the longest identifier is clipped by the frame.
          left: 210,
          right: 200,
          top: 62,
          bottom: 28,
          // Arrows: every relationship here has a direction, and "A depends on
          // B" drawn without one is two different claims.
          edgeSymbol: ['none', 'arrow'],
          edgeSymbolSize: 8,
          // Hovering a node dims everything it is not connected to, which is
          // how a reader follows one plugin through a busy graph.
          emphasis: { focus: 'adjacency' as const, label: { color: onEmphasis } },
          blur: { itemStyle: { opacity: 0.15 }, lineStyle: { opacity: 0.06 } },
          categories: CATEGORIES.map((category, index) => ({
            name: category.name,
            itemStyle: { color: categoryColor[index] },
          })),
          data: nodes,
          links,
        },
      ],
    };
  }, [graph, resolvedColorMode, colorScheme]);

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 3,
          flexWrap: 'wrap',
        }}
      >
        <Text sx={{ color: 'fg.muted', fontSize: 1 }}>
          {graph.nodes.length} nodes, {graph.edges.length} relationships — derived
          from what the plugins declare, not drawn by hand.
        </Text>
        {backend.loading && <Spinner size="small" />}
        {backend.error && (
          <Text sx={{ color: 'attention.fg', fontSize: 0 }}>
            Backend unreachable ({backend.error}) — showing the frontend half.
          </Text>
        )}
      </Box>
      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
        {EDGE_LEGEND.map((entry) => (
          <Box
            key={entry.kind}
            sx={{ display: 'flex', alignItems: 'center', gap: 2 }}
          >
            <Box
              sx={{
                width: 26,
                borderTop: EDGE_STYLES[entry.kind].dashed ? '2px dashed' : '2px solid',
                borderColor: entry.color,
              }}
            />
            <Text sx={{ fontSize: 0, color: 'fg.muted' }}>{entry.description}</Text>
          </Box>
        ))}
      </Box>
      <Box
        sx={{
          border: '1px solid',
          borderColor: 'border.default',
          borderRadius: 2,
          bg: 'canvas.default',
        }}
      >
        <div ref={containerRef} style={{ width: '100%' }}>
          <ReactECharts
            // Remounting on theme change is what makes the chart re-read the
            // tokens; echarts keeps its own canvas otherwise.
            key={`${resolvedColorMode}-${colorScheme}`}
            ref={chartRef}
            option={option}
            style={{ height, width: '100%' }}
            // Belt and braces with the observer above: this catches the window
            // resize, the observer catches every other way the box changes.
            notMerge
            lazyUpdate
          />
        </div>
      </Box>
    </Box>
  );
}

/**
 * The graph plugin: contributes the plugin graph to the `graph` slot.
 *
 * It depends on no other plugin. It reads the platform through the Reactor API
 * every plugin already has — which is why it can draw plugins it knows nothing
 * about — and takes anything it cannot know, the backend's address and plugin
 * list, as props from whoever renders the slot:
 *
 * ```tsx
 * <ReactorSlot slot="graph" props={{ backendUrl, backendPlugins }} />
 * ```
 */
export const GraphPlugin = definePlugin({
  name: '@datalayer/reactor-graph',
  version: '0.1.0',
  displayName: 'Graph',
  description:
    'Draws the plugin graph — extensions, dependencies, contribution points and their contributors, across both tiers.',
  octicon: 'workflow',
  emoji: '🕸️',
  build() {
    return {
      components: [
        {
          slot: 'graph',
          id: 'plugin-graph',
          Component: PluginGraphView,
        },
      ],
    };
  },
});
