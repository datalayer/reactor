/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Plugins panel — switch plugins on and off while the application runs.
 *
 * There are two kinds of plugin in this example and the panel drives both,
 * through mechanisms that have nothing in common:
 *
 * * **Frontend (TypeScript)** — `reactor.enable(name)` / `reactor.disable(name)`
 *   on the platform in the browser. Disabling withdraws everything the
 *   extension contributed: its slot components stop rendering, and so do its
 *   contributions to other plugins' extension points.
 * * **Backend (Python)** — `POST /plugins/{name}/toggle` on the reactor's own
 *   management API. The frontend does not decide this; it asks the server and
 *   re-reads `GET /plugins`.
 *
 * The two meet in `requiredBackendPlugins`: a React extension that declares one
 * stops rendering when that backend plugin is switched off, which is why
 * unchecking Python `catalog` empties the store.
 *
 * @module plugins-panel-plugin
 */

import React, { useEffect, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { Checkbox, FormControl, Text } from '@primer/react';
import { Box, Card } from '@datalayer/primer-addons';
import { defineExtension } from '@datalayer/reactor';
import { useReactorPlatform } from '@datalayer/reactor/react';
import { CATALOG_BACKEND_URL } from '@datalayer-examples/reactor-music-catalog-plugin';

/** One backend plugin, as `GET /plugins` reports it. */
export type BackendPlugin = {
  name: string;
  version?: string;
  description?: string;
  enabled: boolean;
};

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
  return React.useMemo(
    () => (name: string) =>
      plugins.some((plugin) => plugin.name === name && plugin.enabled),
    [plugins],
  );
}

/** The panel's own extension name, which it never offers to switch off. */
const PANEL_EXTENSION_NAME = '@music/plugins-panel';

function FrontendPlugins() {
  const reactor = useReactorPlatform();
  // Re-render whenever anything about the platform changes — including an
  // extension enabling itself, or one disabled elsewhere.
  const revision = useSyncExternalStore(reactor.subscribe, () => reactor.getRevision());

  const names = React.useMemo(
    () => reactor.listExtensions().filter((name) => name !== PANEL_EXTENSION_NAME),
    // `revision` is the snapshot; the list is rebuilt on every call.
    [reactor, revision],
  );

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Text sx={{ fontWeight: 'bold' }}>Frontend plugins (TypeScript)</Text>
      {names.map((name) => {
        const enabled = reactor.isEnabled(name);
        return (
          <FormControl key={name}>
            <Checkbox
              checked={enabled}
              onChange={() => (enabled ? reactor.disable(name) : reactor.enable(name))}
            />
            <FormControl.Label>{name}</FormControl.Label>
          </FormControl>
        );
      })}
      <Text sx={{ color: 'fg.muted', fontSize: 0 }}>
        {PANEL_EXTENSION_NAME} is not listed: a panel that can switch itself off
        cannot switch itself back on.
      </Text>
    </Box>
  );
}

function BackendPlugins() {
  const { plugins, loading, error, refresh, toggle } = useBackendPlugins();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Text sx={{ fontWeight: 'bold' }}>Backend plugins (Python)</Text>
      {loading && plugins.length === 0 && (
        <Text sx={{ color: 'fg.muted' }}>Asking the backend…</Text>
      )}
      {error && (
        <Text sx={{ color: 'danger.fg' }}>Backend unreachable: {error}</Text>
      )}
      {plugins.map((plugin) => (
        <FormControl key={plugin.name}>
          <Checkbox
            checked={plugin.enabled}
            onChange={() => void toggle(plugin.name, !plugin.enabled)}
          />
          <FormControl.Label>{plugin.name}</FormControl.Label>
          {plugin.description && (
            <FormControl.Caption>{plugin.description}</FormControl.Caption>
          )}
        </FormControl>
      ))}
    </Box>
  );
}

function PluginsPanel() {
  return (
    <Card border rounded="medium" shadow="small">
      <Card.Header
        title="Plugins"
        description="Switch plugins off and on while the app runs. Frontend plugins are toggled on the reactor in the browser; backend plugins through the reactor's management API."
      />
      <Card.Content>
        <Box
          sx={{
            display: 'grid',
            gap: 4,
            gridTemplateColumns: ['1fr', '1fr 1fr'],
          }}
        >
          <FrontendPlugins />
          <BackendPlugins />
        </Box>
        <Box sx={{ mt: 3 }}>
          <Text sx={{ color: 'fg.muted', fontSize: 1 }}>
            Try <strong>@music/mood</strong>: switching it off empties the
            playlist's rule chooser, because its rules are contributions to the
            playlist plugin's extension point and are withdrawn with it. Then try
            the Python <strong>catalog</strong> plugin: the catalog and shop
            disappear, because those extensions declare it in{' '}
            <code>requiredBackendPlugins</code>.
          </Text>
        </Box>
      </Card.Content>
    </Card>
  );
}

/**
 * Plugins panel extension.
 *
 * It depends on nothing: the panel drives the platform through the reactor API
 * every extension already has, and reaches the backend over HTTP. That is why
 * it can list plugins it knows nothing about.
 */
export const PluginsPanelExtension = defineExtension({
  name: PANEL_EXTENSION_NAME,
  version: '1.0.0',
  build() {
    return {
      components: [
        {
          slot: 'plugins',
          id: 'plugins-panel',
          Component: PluginsPanel,
        },
      ],
    };
  },
});
