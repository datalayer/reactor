import React, { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { ReactorPlatform } from '../core/platform';

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
  platform: ReactorPlatform;
  isBackendPluginAvailable: (pluginName: string) => boolean;
};

const ReactorReactContext = createContext<ReactorContextValue | null>(null);

export type ReactorProviderProps = {
  platform: ReactorPlatform;
  children: React.ReactNode;
  autoStart?: boolean;
  availableBackendPlugins?: string[];
  isBackendPluginAvailable?: (pluginName: string) => boolean;
};

export function ReactorProvider({
  platform,
  children,
  autoStart = true,
  availableBackendPlugins = [],
  isBackendPluginAvailable,
}: ReactorProviderProps) {
  useEffect(() => {
    if (autoStart) {
      platform.start();
      return () => {
        platform.stop();
      };
    }
    return undefined;
  }, [autoStart, platform]);

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
      platform,
      isBackendPluginAvailable: backendAvailability,
    }),
    [platform, backendAvailability],
  );
  return <ReactorReactContext.Provider value={value}>{children}</ReactorReactContext.Provider>;
}

export function useReactorPlatform(): ReactorPlatform {
  const ctx = useContext(ReactorReactContext);
  if (!ctx) {
    throw new Error('useReactorPlatform must be used within ReactorProvider');
  }
  return ctx.platform;
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
  const platform = useReactorPlatform();
  const isBackendPluginAvailable = useBackendPluginAvailability();
  const snapshot = useSyncExternalStore(
    platform.subscribe,
    () => platform.getRevision(),
  );

  const components = useMemo(() => {
    const out: ReactorSlotComponent[] = [];

    function hasRequiredBackendPlugins(requiredPlugins: string[]): boolean {
      return requiredPlugins.every((pluginName) => isBackendPluginAvailable(pluginName));
    }

    for (const extensionName of platform.listExtensions()) {
      if (!platform.isEnabled(extensionName)) {
        continue;
      }

      const extensionBackendRequirements = platform.getRequiredBackendPlugins(extensionName);
      if (!hasRequiredBackendPlugins(extensionBackendRequirements)) {
        continue;
      }

      const output = platform.getOutput<ReactorReactOutput>(extensionName);
      for (const component of output?.components ?? []) {
        const componentBackendRequirements = component.requiredBackendPlugins ?? [];
        if (component.slot === slot && hasRequiredBackendPlugins(componentBackendRequirements)) {
          out.push(component);
        }
      }
    }
    return out;
  }, [platform, slot, snapshot, isBackendPluginAvailable]);

  return (
    <>
      {components.map((entry) => {
        const Component = entry.Component;
        return <Component key={`${entry.slot}:${entry.id}`} {...props} />;
      })}
    </>
  );
}
