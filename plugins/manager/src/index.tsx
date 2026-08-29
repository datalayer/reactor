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

import { useMemo, useState, useSyncExternalStore } from 'react';
import type { ComponentType } from 'react';
import { Text, TextInput, ToggleSwitch } from '@primer/react';
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
export type ManagedPlugin = {
  name: string;
  displayName: string;
  description?: string;
  emoji?: string;
  enabled: boolean;
  /** Whether this one may be switched off. */
  changeable: boolean;
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
function usePluginRows(protectedNames: Set<string>): ManagedPlugin[] {
  const reactor = useReactorPlatform();
  const revision = useSyncExternalStore(reactor.subscribe, () =>
    reactor.getRevision(),
  );

  return useMemo(() => {
    return reactor.listPlugins().map(name => {
      const manifest = reactor.getManifest(name);
      return {
        name,
        // The identifier is the fallback: a person should always have
        // something to read, and `@music/catalog` beats an empty line.
        displayName: manifest?.displayName ?? name,
        description: manifest?.description,
        emoji: manifest?.emoji,
        enabled: reactor.isEnabled(name),
        changeable: !protectedNames.has(name),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reactor, revision, protectedNames]);
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

function PluginRowView({
  row,
  size,
  onToggle,
}: PluginRowViewProps): JSX.Element {
  // Primer's switch labels itself by pointing at an element, so the name in
  // the row is the label rather than a string repeated beside it.
  const labelId = `plugin-name-${row.name.replace(/[^a-zA-Z0-9]+/g, '-')}`;
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 2,
        py: 2,
        borderBottom: '1px solid',
        borderColor: 'border.muted',
      }}
    >
      <Box sx={{ minWidth: 0, flex: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {row.emoji ? (
            <Text sx={{ fontSize: 1 }} aria-hidden>
              {row.emoji}
            </Text>
          ) : null}
          <Text
            id={labelId}
            sx={{
              fontSize: 1,
              fontWeight: 'semibold',
              // A long package name must not push the switch off the sidebar.
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={row.name}
          >
            {row.displayName}
          </Text>
        </Box>
        {row.description ? (
          <Text sx={{ display: 'block', fontSize: 0, color: 'fg.muted' }}>
            {row.description}
          </Text>
        ) : null}
      </Box>
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
  switchSize,
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

  const rows = usePluginRows(protectedNames);
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
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
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
