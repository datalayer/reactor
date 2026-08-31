/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { ReactorPlatform } from '../core/reactor';
import type { PluginManifest } from '../core/plugin';
import type { ExtensionManifest } from '../core/extension';
import { effect, type ReadonlySignal, type Signal } from '../core/signals';

export type ReactorSlotComponent = {
  slot: string;
  id: string;
  Component: React.ComponentType<Record<string, unknown>>;
  requiredBackendPlugins?: string[];
};

export type ReactorReactOutput = {
  components?: ReactorSlotComponent[];
};

/**
 * Global reactor store.
 *
 * The React bridge deliberately avoids React Context: the reactor platform is
 * held in this module-level zustand store so that any component — including
 * portaled content that renders outside any subtree (overlays, dialogs,
 * tooltips) — can read the platform without a surrounding provider.
 */
export type ReactorStoreState = {
  reactor: ReactorPlatform | null;
  isBackendPluginAvailable: (pluginName: string) => boolean;
};

export const useReactorStore = create<ReactorStoreState>(() => ({
  reactor: null,
  isBackendPluginAvailable: () => false,
}));

const unavailableBackendPlugin = () => false;

/** Imperatively register the reactor platform + backend availability. */
export function registerReactor(
  reactor: ReactorPlatform | null,
  isBackendPluginAvailable: (pluginName: string) => boolean = unavailableBackendPlugin,
): void {
  useReactorStore.setState({ reactor, isBackendPluginAvailable });
}

export type UseReactorOptions = {
  /** Start the platform on mount and stop it on unmount. Defaults to `true`. */
  autoStart?: boolean;
  /** Names of backend plugins currently available (used for slot gating). */
  availableBackendPlugins?: string[];
  /** Custom predicate overriding `availableBackendPlugins`. */
  isBackendPluginAvailable?: (pluginName: string) => boolean;
};

/**
 * Publishes the reactor platform to the module-level zustand store and manages
 * its lifecycle. This replaces the former `<ReactorProvider>` component: there
 * is no React Context and no wrapper element — call this hook once (typically in
 * your root component) and render your tree directly.
 *
 * Because the platform lives in a global store, any component (including
 * portaled overlays that render outside the React subtree) can reach it via
 * `useReactorPlatform()` / `ReactorSlot` without an ancestor provider.
 */
export function useReactor(reactor: ReactorPlatform, options: UseReactorOptions = {}): ReactorPlatform {
  const { autoStart = true, availableBackendPlugins, isBackendPluginAvailable } = options;

  const backendAvailability = useMemo(() => {
    if (isBackendPluginAvailable) {
      return isBackendPluginAvailable;
    }
    const set = new Set(availableBackendPlugins ?? []);
    return (pluginName: string) => set.has(pluginName);
  }, [isBackendPluginAvailable, availableBackendPlugins]);

  // Register synchronously on first render so portaled content (which renders
  // outside this subtree) observes a populated reactor immediately.
  useState(() => {
    registerReactor(reactor, backendAvailability);
    return null;
  });

  // Keep the store in sync when the reactor or backend availability changes.
  useEffect(() => {
    registerReactor(reactor, backendAvailability);
    return () => {
      const current = useReactorStore.getState();
      if (current.reactor === reactor) {
        registerReactor(null, unavailableBackendPlugin);
      }
    };
  }, [reactor, backendAvailability]);

  // Platform lifecycle.
  useEffect(() => {
    if (!autoStart) {
      return undefined;
    }
    reactor.start();
    return () => {
      reactor.stop();
    };
  }, [autoStart, reactor]);

  return reactor;
}

export function useReactorPlatform(): ReactorPlatform {
  const reactorStore = useReactorStore((state) => state.reactor);
  if (!reactorStore) {
    throw new Error(
      'useReactorPlatform: no reactor store registered. Call useReactor(reactor) (or registerReactor) before using reactor hooks.',
    );
  }
  return reactorStore;
}

/**
 * Subscribe a React component to a reactor `signal` (or `computed`) and return
 * its current value. The component re-renders whenever the signal changes.
 *
 * This is the idiomatic way for one plugin to consume reactive state exposed by
 * another plugin's build output (retrieved via `reactor.getOutput(name)`).
 */
export function useSignalValue<T>(signal: Signal<T> | ReadonlySignal<T>): T {
  return useSyncExternalStore(
    (onStoreChange) => {
      let initialized = false;
      // `effect` tracks the signal on first run and re-runs on every change.
      return effect(() => {
        // Touch `.value` so the effect subscribes to this signal.
        void signal.value;
        if (initialized) {
          onStoreChange();
        } else {
          initialized = true;
        }
      });
    },
    () => signal.peek(),
    () => signal.peek(),
  );
}

function useBackendPluginAvailability(): (pluginName: string) => boolean {
  return useReactorStore((state) => state.isBackendPluginAvailable);
}

/**
 * Whether one backend plugin is available right now.
 *
 * This is how a plugin acts on an *optional* backend plugin: a required
 * one already gates rendering, so by the time a component runs the answer is
 * yes; an optional one is the plugin's own business, and this is what it
 * asks. Re-renders when the host's answer changes.
 */
export function useBackendPlugin(pluginName: string): boolean {
  const isAvailable = useBackendPluginAvailability();
  return isAvailable(pluginName);
}

/**
 * The manifest of one plugin — how it presents itself, what it needs from the
 * backend, and whether its module has arrived.
 *
 * Defined for a lazy plugin before its module loads, which is the point:
 * a host can list and describe a plugin that is still on the wire.
 */
export function usePluginManifest(name: string): PluginManifest | undefined {
  const reactorPlatform = useReactorPlatform();
  const revision = useSyncExternalStore(reactorPlatform.subscribe, () =>
    reactorPlatform.getRevision(),
  );
  return useMemo(
    // `revision` is the snapshot: metadata changes when a lazy module lands.
    () => reactorPlatform.getManifest(name),
    [reactorPlatform, name, revision],
  );
}

/**
 * The manifest of every plugin the platform knows, in dependency order.
 *
 * Includes lazy plugins that have not loaded, so a plugin list is complete
 * from the first paint rather than growing as modules arrive.
 */
export function usePluginManifests(): PluginManifest[] {
  const reactorPlatform = useReactorPlatform();
  const revision = useSyncExternalStore(reactorPlatform.subscribe, () =>
    reactorPlatform.getRevision(),
  );
  return useMemo(
    () =>
      reactorPlatform
        .listPlugins()
        .map((name) => reactorPlatform.getManifest(name))
        .filter((entry): entry is PluginManifest => Boolean(entry)),
    [reactorPlatform, revision],
  );
}

/**
 * The extensions that delivered plugins, and what each delivered.
 *
 * For hosts that present a plugin list grouped the way it was installed —
 * "Notebooks" with four plugins under it, rather than four peers. The grouping
 * is read from the same manifests the ungrouped list uses, so the two can
 * never disagree.
 */
export function useExtensionManifests(): ExtensionManifest[] {
  const reactorPlatform = useReactorPlatform();
  const revision = useSyncExternalStore(reactorPlatform.subscribe, () =>
    reactorPlatform.getRevision(),
  );
  return useMemo(
    () =>
      reactorPlatform
        .listExtensions()
        .map((name) => reactorPlatform.getExtensionManifest(name))
        .filter((entry): entry is ExtensionManifest => Boolean(entry)),
    [reactorPlatform, revision],
  );
}

/**
 * Plugin manifests grouped by the extension that delivered them.
 *
 * Ungrouped plugins come back under `extension: undefined`, in one bucket at
 * the end — a plugin installed on its own is not an error, and a list that
 * hid it would be lying.
 */
export function useGroupedPluginManifests(): {
  extension?: ExtensionManifest;
  plugins: PluginManifest[];
}[] {
  const extensions = useExtensionManifests();
  const plugins = usePluginManifests();
  return useMemo(() => {
    const byExtension = new Map<string, PluginManifest[]>();
    const loose: PluginManifest[] = [];
    for (const plugin of plugins) {
      if (!plugin.extension) {
        loose.push(plugin);
        continue;
      }
      const bucket = byExtension.get(plugin.extension);
      if (bucket) {
        bucket.push(plugin);
      } else {
        byExtension.set(plugin.extension, [plugin]);
      }
    }
    const groups = extensions
      .filter((extension) => byExtension.has(extension.name))
      .map((extension) => ({
        extension,
        plugins: byExtension.get(extension.name)!,
      }));
    return loose.length > 0 ? [...groups, { plugins: loose }] : groups;
  }, [extensions, plugins]);
}

/**
 * Fire a reactor event when a value changes.
 *
 * The bridge between "the application did something" and "the plugins waiting
 * on it change state" — opening a view, selecting a document, running a
 * command. One event both stands down whatever was waiting to and wakes
 * whatever was waiting for it, so switching views retires the old view's
 * plugins and brings up the new one's in a single call.
 *
 * Firing an event nobody waits on is free, so this can be wired
 * unconditionally rather than guarded.
 *
 * ```tsx
 * useReactorEvent(onView(activeViewType));
 * ```
 */
/** What `GET /plugins/state` answers. */
export type BackendPluginState = {
  revision: number;
  plugins: { name: string; enabled: boolean; activated: boolean }[];
};

export type BackendPluginStreamOptions = {
  /** Fall back to polling this often when the stream is unavailable, in ms. */
  pollMs?: number;
  /** Called with every snapshot, for a host that draws the backend list. */
  onState?: (state: BackendPluginState) => void;
};

/**
 * Follow a Reactor backend's plugins, and let this platform's activation
 * follow with them.
 *
 * The browser half of cross-tier activation. `requiredBackendPlugins` has
 * always gated rendering; this is what makes a frontend plugin actually stand
 * down when the server plugin it needs is switched off, and come back when it
 * returns — see `setBackendPlugins`.
 *
 * ```tsx
 * useBackendPluginStream('http://localhost:8799');
 * ```
 *
 * Two properties worth knowing, both deliberate:
 *
 * - **A dropped connection is not a server saying no.** The last known state is
 *   kept, and nothing is torn down because the network blinked. Tearing plugins
 *   down on a disconnect would be the same mistake as a backend refusing to
 *   start because no browser had loaded yet.
 * - **Polling is correct.** The stream is an optimisation over
 *   `GET /plugins/state`, and the fallback is the same code path with a timer,
 *   so a deployment that cannot hold a connection open loses latency and
 *   nothing else.
 */
export function useBackendPluginStream(
  backendUrl: string | undefined,
  options: BackendPluginStreamOptions = {},
): void {
  const { pollMs = 5000, onState } = options;
  // Normalised once, so a caller passing a trailing slash does not produce
  // `http://host//plugins/state` — which works, and then differs from the
  // un-slashed form in every log, cache key and comparison downstream.
  const backend = backendUrl?.replace(/\/+$/, '');
  const reactor = useReactorStore((state) => state.reactor);
  // Read through a ref so that a caller passing an inline `onState` does not
  // tear the connection down on every render.
  const onStateRef = useRef(onState);
  onStateRef.current = onState;

  useEffect(() => {
    if (!backend || !reactor) {
      return;
    }
    let cancelled = false;
    let lastRevision = -1;

    const apply = (state: BackendPluginState) => {
      if (cancelled || state.revision === lastRevision) {
        return;
      }
      lastRevision = state.revision;
      onStateRef.current?.(state);
      void reactor.setBackendPlugins(
        state.plugins.filter((plugin) => plugin.enabled).map((plugin) => plugin.name),
      );
    };

    // The first answer comes from a plain request rather than from the stream,
    // so a host is in step even where EventSource is unavailable.
    const poll = () =>
      fetch(`${backend}/plugins/state`)
        .then((response) => (response.ok ? response.json() : undefined))
        .then((state) => state && apply(state as BackendPluginState))
        .catch(() => {
          // Unreachable is not "said no". Keep what we last knew.
        });

    void poll();

    if (typeof EventSource === 'undefined') {
      const timer = setInterval(poll, pollMs);
      return () => {
        cancelled = true;
        clearInterval(timer);
      };
    }

    const source = new EventSource(`${backend}/events/stream`);
    source.onmessage = (message) => {
      try {
        apply(JSON.parse(message.data) as BackendPluginState);
      } catch {
        // A malformed frame is one frame, not a reason to stop listening.
      }
    };
    // EventSource reconnects on its own; the poll is what closes the gap while
    // it is down, since a change during the outage has no event to replay.
    const timer = setInterval(poll, pollMs);

    return () => {
      cancelled = true;
      clearInterval(timer);
      source.close();
    };
  }, [backend, reactor, pollMs]);
}

export function useReactorEvent(event: string | undefined): void {
  const reactorPlatform = useReactorPlatform();
  useEffect(() => {
    if (!event) {
      return;
    }
    void reactorPlatform.fire(event);
  }, [reactorPlatform, event]);
}

export type ReactorSlotProps = {
  slot: string;
  props?: Record<string, unknown>;
};

/**
 * What would render in a slot, right now.
 *
 * `ReactorSlot` renders them; this answers the question a host asks *before*
 * rendering — is there anything here at all? A sidebar column, a toolbar
 * separator, a whole panel: chrome that should not be drawn around nothing.
 * Without this a host has to guess, and guessing means drawing an empty frame
 * whenever no plugin happens to fill the slot.
 *
 * Enabled plugins only, and only those whose required backend plugins are
 * available — the same test `ReactorSlot` applies, so the two never disagree.
 */
export function useSlotComponents(slot: string): ReactorSlotComponent[] {
  const reactorPlatform = useReactorPlatform();
  const isBackendPluginAvailable = useBackendPluginAvailability();
  const snapshot = useSyncExternalStore(
    reactorPlatform.subscribe,
    () => reactorPlatform.getRevision(),
  );

  return useMemo(() => {
    const out: ReactorSlotComponent[] = [];

    function hasRequiredBackendPlugins(requiredPlugins: string[]): boolean {
      return requiredPlugins.every((pluginName) => isBackendPluginAvailable(pluginName));
    }

    for (const pluginName of reactorPlatform.listPlugins()) {
      if (!reactorPlatform.isEnabled(pluginName)) {
        continue;
      }

      const backendRequirements = reactorPlatform.getRequiredBackendPlugins(pluginName);
      if (!hasRequiredBackendPlugins(backendRequirements)) {
        continue;
      }

      const output = reactorPlatform.getOutput<ReactorReactOutput>(pluginName);
      for (const component of output?.components ?? []) {
        const componentBackendRequirements = component.requiredBackendPlugins ?? [];
        if (component.slot === slot && hasRequiredBackendPlugins(componentBackendRequirements)) {
          out.push(component);
        }
      }
    }
    return out;
  }, [reactorPlatform, slot, snapshot, isBackendPluginAvailable]);
}

export function ReactorSlot({ slot, props = {} }: ReactorSlotProps) {
  const components = useSlotComponents(slot);

  return (
    <>
      {components.map((entry) => {
        const Component = entry.Component;
        return <Component key={`${entry.slot}:${entry.id}`} {...props} />;
      })}
    </>
  );
}
