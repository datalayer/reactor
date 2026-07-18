import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { ReactorPlatform } from '../core/reactor';

export type ReactorSlotComponent = {
  slot: string;
  id: string;
  Component: React.ComponentType<Record<string, unknown>>;
  requiredBackendPlugins?: string[];
};

export type ReactorReactOutput = {
  components?: ReactorSlotComponent[];
};

type ReactorContextValue = {
  reactor: ReactorPlatform;
  isBackendPluginAvailable: (pluginName: string) => boolean;
};

const ReactorReactContext = createContext<ReactorContextValue | null>(null);

export type ReactorProviderProps = {
  reactor: ReactorPlatform;
  children: React.ReactNode;
  autoStart?: boolean;
  availableBackendPlugins?: string[];
  isBackendPluginAvailable?: (pluginName: string) => boolean;
};

export function ReactorProvider({
  reactor,
  children,
  autoStart = true,
  availableBackendPlugins = [],
  isBackendPluginAvailable,
}: ReactorProviderProps) {
  useEffect(() => {
    if (autoStart) {
      reactor.start();
      return () => {
        reactor.stop();
      };
    }
    return undefined;
  }, [autoStart, reactor]);

  const backendPluginSet = useMemo(() => new Set(availableBackendPlugins), [availableBackendPlugins]);
  const backendAvailability = useMemo(
    () =>
      isBackendPluginAvailable ??
      ((pluginName: string) => {
        return backendPluginSet.has(pluginName);
      }),
    [isBackendPluginAvailable, backendPluginSet],
  );

  const value = useMemo(
    () => ({
      reactor,
      isBackendPluginAvailable: backendAvailability,
    }),
    [reactor, backendAvailability],
  );
  return <ReactorReactContext.Provider value={value}>{children}</ReactorReactContext.Provider>;
}

export function useReactorPlatform(): ReactorPlatform {
  const ctx = useContext(ReactorReactContext);
  if (!ctx) {
    throw new Error('useReactorPlatform must be used within ReactorProvider');
  }
  return ctx.reactor;
}

function useBackendPluginAvailability(): (pluginName: string) => boolean {
  const ctx = useContext(ReactorReactContext);
  if (!ctx) {
    throw new Error('useBackendPluginAvailability must be used within ReactorProvider');
  }
  return ctx.isBackendPluginAvailable;
}

export type ReactorSlotProps = {
  slot: string;
  props?: Record<string, unknown>;
};

export function ReactorSlot({ slot, props = {} }: ReactorSlotProps) {
  const reactor = useReactorPlatform();
  const isBackendPluginAvailable = useBackendPluginAvailability();
  const snapshot = useSyncExternalStore(
    reactor.subscribe,
    () => reactor.getRevision(),
  );

  const components = useMemo(() => {
    const out: ReactorSlotComponent[] = [];

    function hasRequiredBackendPlugins(requiredPlugins: string[]): boolean {
      return requiredPlugins.every((pluginName) => isBackendPluginAvailable(pluginName));
    }

    for (const extensionName of reactor.listExtensions()) {
      if (!reactor.isEnabled(extensionName)) {
        continue;
      }

      const extensionBackendRequirements = reactor.getRequiredBackendPlugins(extensionName);
      if (!hasRequiredBackendPlugins(extensionBackendRequirements)) {
        continue;
      }

      const output = reactor.getOutput<ReactorReactOutput>(extensionName);
      for (const component of output?.components ?? []) {
        const componentBackendRequirements = component.requiredBackendPlugins ?? [];
        if (component.slot === slot && hasRequiredBackendPlugins(componentBackendRequirements)) {
          out.push(component);
        }
      }
    }
    return out;
  }, [reactor, slot, snapshot, isBackendPluginAvailable]);

  return (
    <>
      {components.map((entry) => {
        const Component = entry.Component;
        return <Component key={`${entry.slot}:${entry.id}`} {...props} />;
      })}
    </>
  );
}
