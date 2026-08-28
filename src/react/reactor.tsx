/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { ReactorPlatform } from '../core/reactor';
import type { ExtensionMetadata } from '../core/extension';
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
 * This is how an extension acts on an *optional* backend plugin: a required
 * one already gates rendering, so by the time a component runs the answer is
 * yes; an optional one is the extension's own business, and this is what it
 * asks. Re-renders when the host's answer changes.
 */
export function useBackendPlugin(pluginName: string): boolean {
  const isAvailable = useBackendPluginAvailability();
  return isAvailable(pluginName);
}

/**
 * Metadata for one extension — how it presents itself, what it needs from the
 * backend, and whether its module has arrived.
 *
 * Defined for a lazy extension before its module loads, which is the point:
 * a host can list and describe a plugin that is still on the wire.
 */
export function useExtensionMetadata(name: string): ExtensionMetadata | undefined {
  const reactorPlatform = useReactorPlatform();
  const revision = useSyncExternalStore(reactorPlatform.subscribe, () =>
    reactorPlatform.getRevision(),
  );
  return useMemo(
    // `revision` is the snapshot: metadata changes when a lazy module lands.
    () => reactorPlatform.getMetadata(name),
    [reactorPlatform, name, revision],
  );
}

/**
 * Metadata for every extension the platform knows, in dependency order.
 *
 * Includes lazy extensions that have not loaded, so a plugin list is complete
 * from the first paint rather than growing as modules arrive.
 */
export function useExtensionsMetadata(): ExtensionMetadata[] {
  const reactorPlatform = useReactorPlatform();
  const revision = useSyncExternalStore(reactorPlatform.subscribe, () =>
    reactorPlatform.getRevision(),
  );
  return useMemo(
    () =>
      reactorPlatform
        .listExtensions()
        .map((name) => reactorPlatform.getMetadata(name))
        .filter((entry): entry is ExtensionMetadata => Boolean(entry)),
    [reactorPlatform, revision],
  );
}

export type ReactorSlotProps = {
  slot: string;
  props?: Record<string, unknown>;
};

export function ReactorSlot({ slot, props = {} }: ReactorSlotProps) {
  const reactorPlatform = useReactorPlatform();
  const isBackendPluginAvailable = useBackendPluginAvailability();
  const snapshot = useSyncExternalStore(
    reactorPlatform.subscribe,
    () => reactorPlatform.getRevision(),
  );

  const components = useMemo(() => {
    const out: ReactorSlotComponent[] = [];

    function hasRequiredBackendPlugins(requiredPlugins: string[]): boolean {
      return requiredPlugins.every((pluginName) => isBackendPluginAvailable(pluginName));
    }

    for (const extensionName of reactorPlatform.listExtensions()) {
      if (!reactorPlatform.isEnabled(extensionName)) {
        continue;
      }

      const extensionBackendRequirements = reactorPlatform.getRequiredBackendPlugins(extensionName);
      if (!hasRequiredBackendPlugins(extensionBackendRequirements)) {
        continue;
      }

      const output = reactorPlatform.getOutput<ReactorReactOutput>(extensionName);
      for (const component of output?.components ?? []) {
        const componentBackendRequirements = component.requiredBackendPlugins ?? [];
        if (component.slot === slot && hasRequiredBackendPlugins(componentBackendRequirements)) {
          out.push(component);
        }
      }
    }
    return out;
  }, [reactorPlatform, slot, snapshot, isBackendPluginAvailable]);

  return (
    <>
      {components.map((entry) => {
        const Component = entry.Component;
        return <Component key={`${entry.slot}:${entry.id}`} {...props} />;
      })}
    </>
  );
}
