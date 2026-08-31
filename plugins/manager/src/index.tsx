/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The plugins manager: every plugin in the platform, and a switch for each.
 *
 * A sidebar is a strange thing for an application to own. It is the one
 * surface whose whole job is the plugin system itself — what is installed,
 * what is running, what a person may turn off — and every host that offered
 * one had written its own, which meant every host had a slightly different
 * answer to the same questions.
 *
 * So this is a plugin, and it is generic. It depends on no other plugin and
 * knows none of them by name: it reads the platform through the Reactor API
 * that every plugin already has, which is why it can list plugins written long
 * after it.
 *
 * Two things it deliberately does not decide:
 *
 * - **What else belongs in the sidebar.** Anything a plugin wants beside the
 *   list goes through the {@link MANAGER_ACTIONS_SLOT} slot, which is why the
 *   graph plugin's own button disappears when the graph plugin is switched
 *   off. A button that outlives the thing it opens is a broken button.
 * - **Which plugins may be switched off.** A host that would break without one
 *   names it in {@link PluginsManagerConfig.protected}; the manager shows it
 *   with the switch fixed on rather than hiding it, because a person looking
 *   for a plugin should find it whether or not they can act on it.
 *
 * @module manager-plugin
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { ComponentType } from 'react';
import {
  AnchoredOverlay,
  Text,
  TextInput,
  ToggleSwitch,
  Truncate,
} from '@primer/react';
import { Box } from '@datalayer/primer-addons';
import { SearchIcon } from '@primer/octicons-react';
import { defineContributionPoint, definePlugin } from '@datalayer/reactor';
import {
  ReactorSlot,
  useContributions,
  useReactorPlatform,
} from '@datalayer/reactor/react';

/** This plugin's name, for configuring it and for protecting it. */
export const MANAGER_PLUGIN_NAME = '@datalayer/reactor-manager';

/**
 * Where anything else in the sidebar goes.
 *
 * A plugin contributing here gets whatever props the host handed the manager,
 * unchanged — the manager has no idea what a graph button needs to navigate,
 * and no business inventing one.
 */
export const MANAGER_ACTIONS_SLOT = 'manager-actions';

export type PluginsManagerConfig = {
  /**
   * Plugins whose switch is fixed on.
   *
   * The manager protects itself by default: switching off the only way back
   * is a trap, not a feature. A host naming its own additions here replaces
   * that default, so it should include the manager unless it means to allow
   * that.
   */
  protected?: string[];
  /** Heading above the list. */
  title?: string;
  /**
   * Plugins to leave out of the list entirely.
   *
   * For a plugin that is an implementation detail of another: a thin adapter
   * and the generic plugin it depends on are one feature to the person reading
   * the sidebar, and two switches for one feature is a question they cannot
   * answer. Switching off the one that places it is enough.
   *
   * Deliberately a host's decision rather than something inferred from the
   * dependency graph. A dependency is often worth switching on its own — the
   * music example asks you to try exactly that — so hiding every one of them
   * would remove the point.
   */
  hidden?: string[];
  /**
   * How wide the panel is.
   *
   * A number is pixels. Given one, the list is laid out to it and the
   * descriptions are truncated to fit — a description that wraps to four lines
   * turns a scannable list into a wall, and one that overflows pushes the
   * switch off the edge.
   */
  width?: number | string;
  /**
   * How large the switches are.
   *
   * Small by default: a sidebar row is a name, a description and a control,
   * and the control is the least of the three. A host with room, or one whose
   * switches are the point, can ask for the full size.
   */
  switchSize?: ToggleSwitchSize;
};

/** The sizes Primer's switch offers. */
export type ToggleSwitchSize = 'small' | 'medium';

/** What the manager needs to draw one row. */
/** One labelled fact about a plugin, for the hover overlay. */
export type PluginDetail = {
  label: string;
  /** Rendered as a list. An empty one is left out rather than shown blank. */
  values: string[];
};

export type ManagedPlugin = {
  name: string;
  displayName: string;
  description?: string;
  emoji?: string;
  version?: string;
  enabled: boolean;
  /** Whether this one may be switched off. */
  changeable: boolean;
  /**
   * Everything else worth knowing, shown on hover.
   *
   * Supplied rather than derived, because only the source of a plugin knows
   * what is true about it: the reactor can say what a frontend plugin
   * contributes, and nothing generic can say what a Python one depends on.
   */
  details?: PluginDetail[];
};

/** @deprecated Use {@link ManagedPlugin}. */
export type PluginRow = ManagedPlugin;

/**
 * A group of plugins the manager did not find for itself.
 *
 * The reactor in this browser is not always the whole system. An application
 * with plugins on the other side of a wire has a second set to manage, and
 * nothing generic can know they exist — but a person looking at a sidebar
 * should not have to learn two different controls because of where a plugin
 * happens to run.
 *
 * So a source contributes a *component* rather than a list: it renders its own
 * rows with {@link PluginList}, which is the same one the manager uses, and
 * keeps whatever fetching, polling or caching its tier needs to itself. A list
 * would have meant the manager calling somebody else's hook, which is not a
 * thing a component can do conditionally.
 */
export type PluginSource = {
  /** Heading above this group. */
  title: string;
  /** Where it sits. The reactor's own plugins are 0; sources default after. */
  order?: number;
  /** Renders the group's rows, filtered and sized as the manager asks. */
  Component: ComponentType<PluginSourceProps>;
};

export type PluginSourceProps = {
  /** What is typed in the filter, for the source to apply itself. */
  query: string;
  /** How large the switches are, so every group matches. */
  switchSize: ToggleSwitchSize;
};

/** Where a plugin adds a group of plugins to the manager's list. */
export const ManagerPluginSource = defineContributionPoint<PluginSource>(
  'manager.pluginSource',
);

/**
 * Re-read the platform whenever anything in it changes.
 *
 * `getRevision` is the snapshot: the rows are rebuilt on every call, so they
 * cannot be compared by identity, and enabling a plugin has to redraw the row
 * that did it.
 */
function usePluginRows(
  protectedNames: Set<string>,
  hiddenNames: Set<string>,
): ManagedPlugin[] {
  const reactor = useReactorPlatform();
  const revision = useSyncExternalStore(reactor.subscribe, () =>
    reactor.getRevision(),
  );

  return useMemo(() => {
    return reactor
      .listPlugins()
      .filter(name => !hiddenNames.has(name))
      .map(name => {
      const manifest = reactor.getManifest(name);
      return {
        name,
        // The identifier is the fallback: a person should always have
        // something to read, and `@music/catalog` beats an empty line.
        displayName: manifest?.displayName ?? name,
        description: manifest?.description,
        emoji: manifest?.emoji,
        version: manifest?.version,
        enabled: reactor.isEnabled(name),
        changeable: !protectedNames.has(name),
        // What the reactor knows and a row has no room for.
        details: [
          {
            label: 'Delivered by',
            values: manifest?.extension ? [manifest.extension] : [],
          },
          {
            label: 'Contributes to',
            values: manifest?.contributesTo ?? [],
          },
          {
            label: 'Offers contribution points',
            values: manifest?.contributionPoints ?? [],
          },
          {
            label: 'Requires backend plugins',
            values: manifest?.requiredBackendPlugins ?? [],
          },
          {
            label: 'Uses if available',
            values: manifest?.optionalBackendPlugins ?? [],
          },
          {
            label: 'Activates on',
            values: manifest?.activationEvents ?? [],
          },
        ],
      };
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reactor, revision, protectedNames, hiddenNames]);
}

/** Whether a row answers what was typed in the filter. */
export function pluginMatches(row: ManagedPlugin, query: string): boolean {
  if (!query) {
    return true;
  }
  const needle = query.trim().toLowerCase();
  return [row.name, row.displayName, row.description ?? '']
    .join(' ')
    .toLowerCase()
    .includes(needle);
}

type PluginRowViewProps = {
  row: ManagedPlugin;
  size: ToggleSwitchSize;
  onToggle: (name: string, next: boolean) => void;
};

/**
 * Which row's overlay is open — one for the whole panel, not one per row.
 *
 * Rows used to own this individually, and the result was overlays cascading:
 * moving down the list left a pending close on the row behind while the next
 * one opened, so two or three hung about and vanished out of order. "At most
 * one is open" is a fact about the panel, so the panel is where it lives, and
 * opening one closes the rest by construction rather than by timing.
 *
 * Shared across groups too: hovering a backend plugin closes a frontend one.
 */
type HoverControl = {
  openName: string | null;
  /** Open this row now, cancelling any pending close. */
  show: (name: string) => void;
  /** Close after a beat, so the pointer can cross into the overlay. */
  hide: () => void;
};

const PluginHoverContext = createContext<HoverControl | null>(null);

/** The one control, created by whoever renders the list. */
function usePluginHoverControl(): HoverControl {
  const [openName, setOpenName] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(timer.current), []);

  return useMemo(
    () => ({
      openName,
      show: (name: string) => {
        clearTimeout(timer.current);
        setOpenName(name);
      },
      hide: () => {
        clearTimeout(timer.current);
        // Long enough to cross the gap between a row and its overlay, short
        // enough that a list scanned quickly does not trail open panels.
        timer.current = setTimeout(() => setOpenName(null), 200);
      },
    }),
    [openName],
  );
}

/**
 * The hover control, falling back to a private one.
 *
 * A `PluginList` rendered on its own — outside the manager — still needs
 * hover to work, and a row is not the place to discover that nobody is
 * coordinating.
 */
function useHoverControl(): HoverControl {
  const shared = useContext(PluginHoverContext);
  const own = usePluginHoverControl();
  return shared ?? own;
}

/** Everything about one plugin, shown while the pointer rests on its row. */
function PluginDetails({ row }: { row: ManagedPlugin }): JSX.Element {
  const details = (row.details ?? []).filter(detail => detail.values.length > 0);
  return (
    <Box sx={{ p: 3, maxWidth: 360, display: 'grid', gap: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        {row.emoji ? <Text aria-hidden>{row.emoji}</Text> : null}
        <Text sx={{ fontWeight: 'semibold' }}>{row.displayName}</Text>
        {row.version ? (
          <Text sx={{ fontSize: 0, color: 'fg.muted' }}>v{row.version}</Text>
        ) : null}
      </Box>
      {/* The identifier, in full. The row shows a display name and truncates
          it; this is the overlay's whole reason for existing. */}
      <Text sx={{ fontSize: 0, color: 'fg.muted', wordBreak: 'break-all' }}>
        {row.name}
      </Text>
      {row.description ? (
        <Text sx={{ fontSize: 0 }}>{row.description}</Text>
      ) : null}
      {details.map(detail => (
        <Box key={detail.label} sx={{ display: 'grid', gap: 1 }}>
          <Text sx={{ fontSize: 0, fontWeight: 'semibold' }}>
            {detail.label}
          </Text>
          {detail.values.map(value => (
            <Text
              key={value}
              sx={{ fontSize: 0, color: 'fg.muted', wordBreak: 'break-all' }}
            >
              {value}
            </Text>
          ))}
        </Box>
      ))}
      {!row.changeable ? (
        <Text sx={{ fontSize: 0, color: 'attention.fg' }}>
          This one cannot be switched off.
        </Text>
      ) : null}
    </Box>
  );
}

/**
 * Overlay settings for a companion that must not move focus.
 *
 * `preventFocusOnOpen` stops it focusing itself; that alone is not enough,
 * because Primer's cleanup calls `returnFocusRef.current?.focus()` whichever
 * way the overlay was opened. Pointing that ref at nothing makes the return a
 * no-op, so closing one row's overlay cannot focus its anchor and start the
 * next one opening.
 *
 * Module-level, so it is the same object on every render: Primer keys effects
 * on this ref's identity.
 */
const OVERLAY_TAKES_NO_FOCUS = {
  preventFocusOnOpen: true,
  returnFocusRef: { current: null },
} as const;

function PluginRowView({
  row,
  size,
  onToggle,
}: PluginRowViewProps): JSX.Element {
  // Primer's switch labels itself by pointing at an element, so the name in
  // the row is the label rather than a string repeated beside it.
  const labelId = `plugin-name-${row.name.replace(/[^a-zA-Z0-9]+/g, '-')}`;
  const control = useHoverControl();
  const open = control.openName === row.name;
  const show = () => control.show(row.name);
  const hide = () => control.hide();

  return (
    <Box
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 2,
        py: 2,
        borderBottom: '1px solid',
        borderColor: 'border.muted',
      }}
    >
      <AnchoredOverlay
        open={open}
        onOpen={show}
        onClose={hide}
        // The pointer stays in the row; the overlay is a companion to it, not
        // somewhere to go — so it never takes focus, and never gives it back.
        //
        // This is what keeps the row's `onFocus`/`onBlur` safe. The overlay is
        // portaled, but it is still a React child of this row, and React sends
        // focus events up the element tree rather than the DOM one. An overlay
        // that focused itself on open therefore told the row it had been
        // focused; one that restored focus on close told the row so again, and
        // the row answered by reopening it. Neither step waits for a paint, so
        // the two ran against each other inside a single commit until React
        // gave up with "Maximum update depth exceeded" — thrown, confusingly,
        // from whichever ref happened to be detached at the time.
        //
        // Nothing here is focusable, so there is nothing to trap, zone, or
        // return to: the details are text, and the row keeps the focus.
        focusZoneSettings={{ disabled: true }}
        focusTrapSettings={{ disabled: true }}
        overlayProps={OVERLAY_TAKES_NO_FOCUS}
        side="outside-left"
        renderAnchor={anchorProps => (
          <Box
            {...(anchorProps as Record<string, unknown>)}
            sx={{ minWidth: 0, flex: 1 }}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {row.emoji ? (
                <Text sx={{ fontSize: 1 }} aria-hidden>
                  {row.emoji}
                </Text>
              ) : null}
              <Text
                id={labelId}
                sx={{ fontSize: 1, fontWeight: 'semibold', minWidth: 0 }}
              >
                {/* Truncated rather than wrapped: a long package name would
                    otherwise push the switch off the edge of the panel. */}
                <Truncate title={row.name} maxWidth="100%" inline>
                  {row.displayName}
                </Truncate>
              </Text>
            </Box>
            {row.description ? (
              <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted' }}>
                {/* One line. The whole of it is in the overlay, which is
                    where somebody who wants to read it will look. */}
                <Truncate title={row.description} maxWidth="100%" inline>
                  {row.description}
                </Truncate>
              </Text>
            ) : null}
          </Box>
        )}
      >
        <PluginDetails row={row} />
      </AnchoredOverlay>
      <ToggleSwitch
        size={size}
        checked={row.enabled}
        disabled={!row.changeable}
        aria-labelledby={labelId}
        onClick={() => {
          if (row.changeable) {
            onToggle(row.name, !row.enabled);
          }
        }}
      />
    </Box>
  );
}

export type PluginListProps = {
  plugins: ManagedPlugin[];
  /** What is typed in the filter. Rows that do not answer it are left out. */
  query?: string;
  switchSize?: ToggleSwitchSize;
  onToggle: (name: string, next: boolean) => void;
  /** Shown when the filter excludes everything. */
  emptyMessage?: string;
};

/**
 * A list of plugins, with a switch each.
 *
 * Exported because the manager is not the only thing that draws one: a
 * {@link PluginSource} renders its own group with this, which is what makes a
 * backend plugin look and behave like a frontend one instead of arriving as
 * somebody else's control.
 */
export function PluginList({
  plugins,
  query = '',
  switchSize = 'small',
  onToggle,
  emptyMessage,
}: PluginListProps): JSX.Element {
  const visible = useMemo(
    () => plugins.filter(row => pluginMatches(row, query)),
    [plugins, query],
  );

  if (visible.length === 0) {
    return (
      <Text sx={{ fontSize: 0, color: 'fg.muted' }}>
        {emptyMessage ?? `No plugin matches “${query}”.`}
      </Text>
    );
  }

  return (
    <>
      {visible.map(row => (
        <PluginRowView
          key={row.name}
          row={row}
          size={switchSize}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}

export type PluginsManagerViewProps = {
  /**
   * Plugins whose switch is fixed on, for a host that mounts this view
   * directly rather than through {@link PluginsManagerPlugin}.
   *
   * Takes precedence over {@link PluginsManagerConfig.protected}, since a host
   * rendering the view itself has no plugin name to configure.
   */
  protectedPlugins?: readonly string[];
  /**
   * Plugins to leave out, for a host that mounts this view directly.
   *
   * Takes precedence over {@link PluginsManagerConfig.hidden}.
   */
  hiddenPlugins?: readonly string[];
  /**
   * How wide the panel is, for a host that mounts this view directly.
   *
   * Takes precedence over {@link PluginsManagerConfig.width}.
   */
  width?: number | string;
  /**
   * How large the switches are, for a host that mounts this view directly.
   *
   * Takes precedence over {@link PluginsManagerConfig.switchSize}.
   */
  switchSize?: ToggleSwitchSize;
  /**
   * Anything the host wants the sidebar's contributed actions to receive.
   *
   * Forwarded to {@link MANAGER_ACTIONS_SLOT} verbatim. Navigation is the
   * usual case: only the application knows how it routes.
   */
  [key: string]: unknown;
};

/**
 * The sidebar: what is installed, and what is running.
 */
export function PluginsManagerView({
  protectedPlugins,
  hiddenPlugins,
  switchSize,
  width,
  ...actions
}: PluginsManagerViewProps): JSX.Element {
  const reactor = useReactorPlatform();
  const config =
    reactor.getConfig<PluginsManagerConfig>(MANAGER_PLUGIN_NAME) ?? {};

  const protectedNames = useMemo(
    () =>
      new Set(protectedPlugins ?? config.protected ?? [MANAGER_PLUGIN_NAME]),
    [protectedPlugins, config.protected],
  );

  const hiddenNames = useMemo(
    () => new Set(hiddenPlugins ?? config.hidden ?? []),
    [hiddenPlugins, config.hidden],
  );

  // One for the whole panel, groups included: hovering a backend plugin
  // closes a frontend one, because only one overlay may be open at a time.
  const hover = usePluginHoverControl();

  const rows = usePluginRows(protectedNames, hiddenNames);
  const [query, setQuery] = useState('');
  const size = switchSize ?? config.switchSize ?? 'small';

  // Groups other plugins added. Sorted here rather than by the reactor,
  // because "after the ones we found ourselves" is this component's opinion
  // about its own list, not a property of the contributions.
  const sources = useContributions(ManagerPluginSource);
  const groups = useMemo(
    () =>
      [...sources]
        .map(entry => entry.value)
        .sort((a, b) => (a.order ?? 100) - (b.order ?? 100)),
    [sources],
  );

  return (
    <PluginHoverContext.Provider value={hover}>
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
        // Laid out to the width it was given, and no wider: the truncation
        // below has to resolve against something definite or it never fires.
        width: width ?? config.width ?? '100%',
        maxWidth: '100%',
        minWidth: 0,
      }}
    >
      {/* Whatever other plugins put here, above the list: these are actions,
          and the list is a reference. */}
      <ReactorSlot slot={MANAGER_ACTIONS_SLOT} props={actions} />

      <Box>
        <Text
          as="h2"
          sx={{ fontSize: 1, fontWeight: 'semibold', display: 'block', mb: 2 }}
        >
          {config.title ?? 'Plugins'}
        </Text>

        <TextInput
          leadingVisual={SearchIcon}
          value={query}
          onChange={event => setQuery(event.target.value)}
          aria-label="Filter plugins"
          placeholder="Filter…"
          block
          size="small"
        />
      </Box>

      <Box>
        <PluginList
          plugins={rows}
          query={query}
          switchSize={size}
          onToggle={(name, next) =>
            next ? reactor.enable(name) : reactor.disable(name)
          }
        />
      </Box>

      {/* Everything managed elsewhere, drawn the same way. A heading each,
          because where a plugin runs is worth knowing even when switching it
          is not different. */}
      {groups.map(group => (
        <Box key={group.title}>
          <Text
            as="h3"
            sx={{
              fontSize: 1,
              fontWeight: 'semibold',
              display: 'block',
              mb: 2,
            }}
          >
            {group.title}
          </Text>
          <group.Component query={query} switchSize={size} />
        </Box>
      ))}
    </Box>
    </PluginHoverContext.Provider>
  );
}

/**
 * The plugins manager plugin.
 *
 * It contributes the sidebar and the point everything else in the sidebar
 * arrives through. Switch it off and the sidebar goes — which is why it
 * protects itself unless a host says otherwise.
 */
export const PluginsManagerPlugin = definePlugin({
  name: MANAGER_PLUGIN_NAME,
  version: '1.0.0',
  displayName: 'Plugins',
  description:
    'Lists every plugin in the platform and switches each one on and off while the application runs.',
  octicon: 'plug',
  emoji: '🔌',
  contributionPoints: [ManagerPluginSource],
  build() {
    return {
      components: [
        {
          slot: 'sidebar',
          id: 'plugins-manager',
          Component: PluginsManagerView,
        },
      ],
    };
  },
});

export default PluginsManagerPlugin;
