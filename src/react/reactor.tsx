/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import React, { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { ReactorPlatform } from '../core/reactor';
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
