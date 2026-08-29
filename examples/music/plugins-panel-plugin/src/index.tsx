/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Backend plugins panel — the Python half, switched from the browser.
 *
 * There are two kinds of plugin in this example, driven through mechanisms
 * that have nothing in common:
 *
 * * **Frontend (TypeScript)** — `reactor.enable(name)` / `reactor.disable(name)`
 *   on the platform in the browser. That is every reactor's business rather
 *   than this example's, so `@datalayer/reactor-manager` does it now: this
 *   panel used to draw the same list beside it, which put two identical
 *   "Plugins" entries in the sidebar switching the same things.
 * * **Backend (Python)** — `POST /plugins/{name}/toggle` on the reactor's own
 *   management API. The frontend does not decide this; it asks the server and
 *   re-reads `GET /plugins`. Nothing generic can know this exists, which is
 *   why this panel still does.
 *
 * The two meet in `requiredBackendPlugins`: a React extension that declares one
 * stops rendering when that backend plugin is switched off, which is why
 * unchecking Python `catalog` empties the store.
 *
 * It fills the `sidebar` slot beside the manager: the switches stay next to
 * the store rather than above it, so what a checkbox does is visible in the
 * same glance as the checkbox itself.
 *
 * @module plugins-panel-plugin
 */

import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import { Heading, Text } from '@primer/react';
import { Box } from '@datalayer/primer-addons';
import { contribution, definePlugin } from '@datalayer/reactor';
import {
  ManagerPluginSource,
  PluginList,
  PluginsManagerPlugin,
  type PluginSourceProps,
} from '@datalayer/reactor-manager';
import { CATALOG_BACKEND_URL } from '@datalayer-examples/reactor-music-catalog-plugin';

/** One backend plugin, as `GET /plugins` reports it. */
export type BackendPlugin = {
  name: string;
  version?: string;
  description?: string;
  /** The same presentation fields the frontend tier declares. */
  display_name?: string;
  octicon?: string;
  emoji?: string;
  dependencies?: string[];
  /** Frontend plugins this backend plugin needs, and merely likes. */
  frontend_dependencies?: string[];
  optional_frontend_dependencies?: string[];
  enabled: boolean;
};

/**
 * The octicons plugins in this example name.
 *
 * A plugin declares an icon by id rather than by importing a component, so a
 * Python plugin can name the same icon as a TypeScript one. The host decides
 * what an id draws — this map is that decision, for this host.
 */

export type BackendPluginsState = {
  plugins: BackendPlugin[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  toggle: (name: string, enabled: boolean) => Promise<void>;
};

/**
 * The backend plugins, as the browser last saw them.
 *
 * A store rather than component state because two things need the answer: this
 * panel, which draws the checkboxes, and the application, which passes
 * `isBackendPluginAvailable` to `useReactor` so that slots gated on a backend
 * plugin disappear with it.
 */
export const useBackendPlugins = create<BackendPluginsState>((set, get) => ({
  plugins: [],
  loading: false,
  error: null,

  async refresh() {
    set({ loading: true });
    try {
      const response = await fetch(`${CATALOG_BACKEND_URL}/plugins`);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const plugins = (await response.json()) as BackendPlugin[];
      set({ plugins, error: null });
    } catch (caught) {
      set({ error: caught instanceof Error ? caught.message : 'unknown error' });
    } finally {
      set({ loading: false });
    }
  },

  async toggle(name, enabled) {
    // Optimistic: the checkbox answers immediately, and `refresh` below
    // replaces the guess with what the server actually did.
    set({
      plugins: get().plugins.map((plugin) =>
        plugin.name === name ? { ...plugin, enabled } : plugin,
      ),
    });
    try {
      const response = await fetch(
        `${CATALOG_BACKEND_URL}/plugins/${encodeURIComponent(name)}/toggle`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ enabled }),
        },
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (caught) {
      set({ error: caught instanceof Error ? caught.message : 'unknown error' });
    }
    await get().refresh();
  },
}));

/**
 * The `isBackendPluginAvailable` predicate for `useReactor`, as a hook.
 *
 * A hook rather than a bare function so the application re-renders when the
 * backend list changes: the predicate's identity changes with it, the reactor
 * store is updated, and every slot gated on a backend plugin re-evaluates. A
 * plain function reading the store would answer correctly and never tell
 * anyone the answer had changed.
 *
 * Until the first `refresh` lands the list is empty and nothing gated on a
 * backend plugin renders — the honest answer, since the browser does not yet
 * know what the server is running.
 */
export function useBackendPluginAvailability(): (name: string) => boolean {
  const plugins = useBackendPlugins((state) => state.plugins);
  return useMemo(
    () => (name: string) =>
      plugins.some((plugin) => plugin.name === name && plugin.enabled),
    [plugins],
  );
}

/** The panel's own extension name, which it never offers to switch off. */
const PANEL_EXTENSION_NAME = '@music/plugins-panel';

/** What the overlay draws — the shape both tiers are reduced to. */
/**
 * The Python plugins, as a group in the plugins manager.
 *
 * It used to be a panel of its own with its own checkboxes, beside the
 * manager's switches — two controls doing the same thing, differing only in
 * which side of the wire the plugin ran on. That is not a distinction a person
 * managing plugins should have to hold.
 *
 * So the rows come from `PluginList`, the manager's own, and only the parts
 * nothing generic could know stay here: where the list comes from
 * (`GET /plugins`), and how one is switched (`POST /plugins/{name}/toggle`).
 */
function BackendPluginSource({ query, switchSize }: PluginSourceProps) {
  const { plugins, loading, error, refresh, toggle } = useBackendPlugins();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const managed = useMemo(
    () =>
      plugins.map((plugin) => ({
        name: plugin.name,
        displayName: plugin.display_name || plugin.name,
        description: plugin.description,
        emoji: plugin.emoji,
        version: plugin.version,
        enabled: plugin.enabled,
        // Every backend plugin is switchable: the server is the authority on
        // what may be turned off, and it answers by refusing.
        changeable: true,
        // What the reactor could never know: these live in another process.
        details: [
          {
            label: 'Depends on backend plugins',
            values: plugin.dependencies ?? [],
          },
          {
            label: 'Requires frontend plugins',
            values: plugin.frontend_dependencies ?? [],
          },
          {
            label: 'Uses frontend plugins if present',
            values: plugin.optional_frontend_dependencies ?? [],
          },
        ],
      })),
    [plugins],
  );

  if (loading && plugins.length === 0) {
    return <Text sx={{ color: 'fg.muted', fontSize: 0 }}>Asking the backend…</Text>;
  }
  if (error) {
    return (
      <Text sx={{ color: 'danger.fg', fontSize: 0 }}>
        Backend unreachable: {error}
      </Text>
    );
  }

  return (
    <PluginList
      plugins={managed}
      query={query}
      switchSize={switchSize}
      onToggle={(name, next) => void toggle(name, next)}
      emptyMessage={`No backend plugin matches “${query}”.`}
    />
  );
}

/**
 * Plugins panel extension.
 *
 * It depends on nothing: the panel drives the platform through the reactor API
 * every extension already has, and reaches the backend over HTTP. That is why
 * it can list plugins it knows nothing about.
 */
export const PluginsPanelPlugin = definePlugin({
  name: PANEL_EXTENSION_NAME,
  version: '1.0.0',
  displayName: 'Backend plugins',
  description:
    'Switches the Python plugins on and off, over the reactor management API.',
  octicon: 'server',
  emoji: '🐍',
  // Contributed to the manager rather than rendered into the sidebar itself:
  // the group appears inside the one list, in the one shape, and disappears
  // with this plugin.
  dependencies: [PluginsManagerPlugin],
  contributes: [
    contribution(
      ManagerPluginSource,
      {
        title: 'Backend plugins (Python)',
        // After the browser's own, which is where they run relative to it.
        order: 100,
        Component: BackendPluginSource,
      },
      { id: 'music-backend-plugins' },
    ),
  ],
});
