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
 *   contributions to other plugins' contribution points.
 * * **Backend (Python)** — `POST /plugins/{name}/toggle` on the reactor's own
 *   management API. The frontend does not decide this; it asks the server and
 *   re-reads `GET /plugins`.
 *
 * The two meet in `requiredBackendPlugins`: a React extension that declares one
 * stops rendering when that backend plugin is switched off, which is why
 * unchecking Python `catalog` empties the store.
 *
 * It fills the `sidebar` slot: the switches stay beside the store rather than
 * above it, so what a checkbox does is visible in the same glance as the
 * checkbox itself.
 *
 * @module plugins-panel-plugin
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { create } from 'zustand';
import { AnchoredOverlay, Checkbox, FormControl, Heading, Label, Text } from '@primer/react';
import { Box } from '@datalayer/primer-addons';
import {
  BookIcon,
  BrowserIcon,
  CreditCardIcon,
  ListUnorderedIcon,
  PackageIcon,
  PlugIcon,
  SunIcon,
  WorkflowIcon,
  type Icon,
} from '@primer/octicons-react';
import { definePlugin, type PluginManifest } from '@datalayer/reactor';
import { usePluginManifests, useReactorPlatform } from '@datalayer/reactor/react';
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
const OCTICONS: Record<string, Icon> = {
  book: BookIcon,
  browser: BrowserIcon,
  'credit-card': CreditCardIcon,
  'list-unordered': ListUnorderedIcon,
  package: PackageIcon,
  plug: PlugIcon,
  sun: SunIcon,
  workflow: WorkflowIcon,
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

/** What the overlay draws — the shape both tiers are reduced to. */
type PluginDetails = {
  name: string;
  title: string;
  version?: string;
  description?: string;
  octicon?: string;
  emoji?: string;
  tier: 'Frontend (TypeScript)' | 'Backend (Python)';
  /** Labelled relationship rows: what this plugin needs, and merely likes. */
  relations: { label: string; values: string[] }[];
  /** Shown while a lazy module is still on the wire. */
  pending?: boolean;
};

function DetailRow({ label, values }: { label: string; values: string[] }) {
  if (values.length === 0) {
    return null;
  }
  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      <Text sx={{ fontSize: 0, fontWeight: 'bold', color: 'fg.muted' }}>{label}</Text>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {values.map((value) => (
          <Label key={value} variant="secondary">
            {value}
          </Label>
        ))}
      </Box>
    </Box>
  );
}

/**
 * Which row's overlay is open, if any.
 *
 * One piece of state for the whole panel rather than one per row: a row that
 * owned its own would have no way of knowing another had opened, and crossing
 * the sidebar — with the grace period below holding each one open — would
 * leave a stack of them on screen at once.
 */
type OverlayControl = {
  openName: string | null;
  setOpenName: React.Dispatch<React.SetStateAction<string | null>>;
};

/**
 * A plugin row that reveals what the plugin says about itself.
 *
 * Hover or focus rather than click: the checkbox is the row's action, and a
 * detail panel that stole the click would put reading and switching in each
 * other's way. Focus opens it too, so the details are not mouse-only.
 */
function PluginOverlay({
  details,
  control,
  children,
}: {
  details: PluginDetails;
  control: OverlayControl;
  children: React.ReactNode;
}) {
  const { openName, setOpenName } = control;
  const open = openName === details.name;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const cancelHide = useCallback(() => {
    if (hideTimer.current !== undefined) {
      clearTimeout(hideTimer.current);
      hideTimer.current = undefined;
    }
  }, []);
  const show = useCallback(() => {
    cancelHide();
    // Opening this one closes whatever else was open, by construction.
    setOpenName(details.name);
  }, [cancelHide, setOpenName, details.name]);
  // A grace period, so crossing the gap between row and overlay does not
  // close the thing you are reaching for. It closes only if this row is still
  // the open one — otherwise it would shut the overlay that replaced it.
  const hide = useCallback(() => {
    cancelHide();
    hideTimer.current = setTimeout(() => {
      // Moving from one row to the next leaves this timer running with a
      // stale idea of what is open. Closing blindly would shut the overlay
      // that replaced this one, so it closes only its own.
      setOpenName((current) => (current === details.name ? null : current));
    }, 200);
  }, [cancelHide, setOpenName, details.name]);
  useEffect(() => cancelHide, [cancelHide]);

  const Icon = details.octicon ? OCTICONS[details.octicon] : undefined;

  return (
    <AnchoredOverlay
      open={open}
      onOpen={show}
      onClose={() => setOpenName(null)}
      side="outside-right"
      align="start"
      width="medium"
      focusTrapSettings={{ disabled: true }}
      focusZoneSettings={{ disabled: true }}
      overlayProps={{
        onMouseEnter: show,
        onMouseLeave: hide,
        preventFocusOnOpen: true,
        sx: { p: 3 },
      }}
      renderAnchor={(anchorProps) => (
        <Box
          {...anchorProps}
          onMouseEnter={show}
          onMouseLeave={hide}
          onFocus={show}
          onBlur={hide}
        >
          {children}
        </Box>
      )}
    >
      <Box sx={{ display: 'grid', gap: 3 }}>
        <Box sx={{ display: 'grid', gap: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
            {details.emoji && <Text sx={{ fontSize: 2 }}>{details.emoji}</Text>}
            {Icon && (
              <Box sx={{ display: 'flex', color: 'fg.muted' }}>
                <Icon size={16} />
              </Box>
            )}
            <Text sx={{ fontWeight: 'bold' }}>{details.title}</Text>
            {details.version && (
              <Label variant="secondary">v{details.version}</Label>
            )}
            {details.pending && <Label variant="attention">loading…</Label>}
          </Box>
          <Text sx={{ fontFamily: 'mono', fontSize: 0, color: 'fg.muted' }}>
            {details.name}
          </Text>
          <Text sx={{ fontSize: 0, color: 'fg.muted' }}>{details.tier}</Text>
        </Box>

        {details.description && (
          <Text sx={{ fontSize: 1, lineHeight: 1.5 }}>{details.description}</Text>
        )}

        {details.relations.map((relation) => (
          <DetailRow key={relation.label} {...relation} />
        ))}
      </Box>
    </AnchoredOverlay>
  );
}

function FrontendPlugins({ control }: { control: OverlayControl }) {
  const reactor = useReactorPlatform();
  // Metadata rather than bare names: it carries how each plugin presents
  // itself, and it is defined for a lazy plugin before its module lands —
  // so the list is complete from the first frame.
  const plugins = usePluginManifests();

  const detailsFor = (metadata: PluginManifest): PluginDetails => ({
    name: metadata.name,
    title: metadata.displayName ?? metadata.name,
    version: metadata.version,
    description: metadata.description,
    octicon: metadata.octicon,
    emoji: metadata.emoji,
    tier: 'Frontend (TypeScript)',
    // Waiting counts as pending too: a plugin held back by an activation event
    // is not yet contributing, and drawing it as live would be a lie.
    pending: (metadata.lazy && !metadata.loaded) || !metadata.activated,
    relations: [
      // The package it arrived in, when it arrived in one. First, because it
      // answers "what would I uninstall to lose this?" before anything else.
      { label: 'Delivered by', values: metadata.extension ? [metadata.extension] : [] },
      { label: 'Requires backend plugins', values: metadata.requiredBackendPlugins },
      { label: 'Uses if available', values: metadata.optionalBackendPlugins },
      {
        label: 'Activates on',
        // Only worth showing when it is not the default: every plugin that
        // says nothing activates at startup, and a column of "onStartup" is
        // noise that hides the one plugin doing something interesting.
        values: metadata.activated
          ? []
          : metadata.activationEvents.filter((event) => event !== 'onStartup'),
      },
      { label: 'Loading', values: metadata.lazy ? ['lazy — loaded on demand'] : [] },
    ],
  });

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Text sx={{ fontWeight: 'bold' }}>Frontend plugins (TypeScript)</Text>
      {plugins
        .filter((metadata) => metadata.name !== PANEL_EXTENSION_NAME)
        .map((metadata) => {
          const enabled = reactor.isEnabled(metadata.name);
          const Icon = metadata.octicon ? OCTICONS[metadata.octicon] : undefined;
          const pending = (metadata.lazy && !metadata.loaded) || !metadata.activated;
          return (
            <PluginOverlay key={metadata.name} details={detailsFor(metadata)} control={control}>
              <FormControl>
                <Checkbox
                  checked={enabled}
                  onChange={() =>
                    enabled ? reactor.disable(metadata.name) : reactor.enable(metadata.name)
                  }
                />
                <FormControl.Label>
                  <Box
                    as="span"
                    sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}
                  >
                    {metadata.emoji && <span>{metadata.emoji}</span>}
                    {Icon && (
                      <Box as="span" sx={{ display: 'inline-flex', color: 'fg.muted' }}>
                        <Icon size={14} />
                      </Box>
                    )}
                    <span>{metadata.displayName ?? metadata.name}</span>
                    {pending && (
                      <Text sx={{ fontSize: 0, color: 'attention.fg' }}>loading…</Text>
                    )}
                  </Box>
                </FormControl.Label>
              </FormControl>
            </PluginOverlay>
          );
        })}
      <Text sx={{ color: 'fg.muted', fontSize: 0 }}>
        {PANEL_EXTENSION_NAME} is not listed: a panel that can switch itself off
        cannot switch itself back on.
      </Text>
    </Box>
  );
}

function BackendPlugins({ control }: { control: OverlayControl }) {
  const { plugins, loading, error, refresh, toggle } = useBackendPlugins();

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const detailsFor = (plugin: BackendPlugin): PluginDetails => ({
    name: plugin.name,
    title: plugin.display_name || plugin.name,
    version: plugin.version,
    description: plugin.description,
    octicon: plugin.octicon,
    emoji: plugin.emoji,
    tier: 'Backend (Python)',
    relations: [
      { label: 'Depends on backend plugins', values: plugin.dependencies ?? [] },
      {
        label: 'Requires frontend plugins',
        values: plugin.frontend_dependencies ?? [],
      },
      {
        label: 'Uses frontend plugins if present',
        values: plugin.optional_frontend_dependencies ?? [],
      },
    ],
  });

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Text sx={{ fontWeight: 'bold' }}>Backend plugins (Python)</Text>
      {loading && plugins.length === 0 && (
        <Text sx={{ color: 'fg.muted' }}>Asking the backend…</Text>
      )}
      {error && (
        <Text sx={{ color: 'danger.fg' }}>Backend unreachable: {error}</Text>
      )}
      {plugins.map((plugin) => {
        const Icon = plugin.octicon ? OCTICONS[plugin.octicon] : undefined;
        return (
          <PluginOverlay key={plugin.name} details={detailsFor(plugin)} control={control}>
            <FormControl>
              <Checkbox
                checked={plugin.enabled}
                onChange={() => void toggle(plugin.name, !plugin.enabled)}
              />
              <FormControl.Label>
                <Box
                  as="span"
                  sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}
                >
                  {plugin.emoji && <span>{plugin.emoji}</span>}
                  {Icon && (
                    <Box as="span" sx={{ display: 'inline-flex', color: 'fg.muted' }}>
                      <Icon size={14} />
                    </Box>
                  )}
                  <span>{plugin.display_name || plugin.name}</span>
                </Box>
              </FormControl.Label>
            </FormControl>
          </PluginOverlay>
        );
      })}
    </Box>
  );
}

function PluginsPanel() {
  // Shared by both lists, so hovering a backend row closes a frontend one.
  const [openName, setOpenName] = useState<string | null>(null);
  const control: OverlayControl = { openName, setOpenName };

  return (
    <Box sx={{ display: 'grid', gap: 4 }}>
      <Box sx={{ display: 'grid', gap: 1 }}>
        <Heading as="h2" sx={{ fontSize: 2 }}>
          Plugins
        </Heading>
        <Text sx={{ color: 'fg.muted', fontSize: 0, lineHeight: 1.5 }}>
          Switch plugins off and on while the app runs. Frontend plugins are
          toggled on the reactor in the browser; backend plugins through the
          reactor's management API.
        </Text>
      </Box>

      <FrontendPlugins control={control} />
      <BackendPlugins control={control} />

      <Box
        sx={{
          pt: 3,
          borderTop: '1px solid',
          borderColor: 'border.muted',
        }}
      >
        <Text sx={{ color: 'fg.muted', fontSize: 0, lineHeight: 1.5 }}>
          Try <strong>@music/mood</strong>: switching it off empties the
          playlist's rule chooser, because its rules are contributions to the
          playlist plugin's contribution point and are withdrawn with it. Then try
          the Python <strong>catalog</strong> plugin: the catalog and shop
          disappear, because those plugins declare it in{' '}
          <code>requiredBackendPlugins</code>.
        </Text>
      </Box>
    </Box>
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
  displayName: 'Plugins',
  description: 'The sidebar: switches every other plugin on and off while the app runs.',
  octicon: 'plug',
  emoji: '🔌',
  build() {
    return {
      components: [
        {
          slot: 'sidebar',
          id: 'plugins-panel',
          Component: PluginsPanel,
        },
      ],
    };
  },
});
