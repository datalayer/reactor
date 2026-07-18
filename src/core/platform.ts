import {
  asConfigured,
  Dispose,
  ExtensionRef,
  mergeWithDefaults,
  ReactorExtension,
  ReactorPlatformView,
} from './extension';

type ExtensionRuntimeState<C, I, O> = {
  extension: ReactorExtension<C, I, O>;
  config: C;
  enabled: boolean;
  initValue?: I;
  outputValue?: O;
  registerDispose?: Dispose;
  afterDispose?: Dispose;
};

export type BuildOptions = {
  strictPeerDependencies?: boolean;
};

export type ReactorPlatform = ReactorPlatformView & {
  start: () => void;
  stop: () => void;
  enable: (name: string) => void;
  disable: (name: string) => void;
  subscribe: (listener: () => void) => () => void;
  listExtensions: () => string[];
  getConfig: <C = unknown>(name: string) => C | undefined;
  /**
   * Monotonically increasing revision that changes on every platform mutation
   * (start, stop, enable, disable). External subscribers (e.g. the React
   * bridge) can use it as a stable snapshot value so they re-render whenever
   * the platform changes — including when `start()` populates build outputs
   * without changing any extension's enabled flag.
   */
  getRevision: () => number;
};

export function shallowMergeConfig<C>(base: C, override: Partial<C>): C {
  return { ...(base as object), ...(override as object) } as C;
}

function normalizeExtensions(input: ExtensionRef[]): ReactorExtension<any, any, any>[] {
  const discovered = new Map<string, ReactorExtension<any, any, any>>();
  const queue: ExtensionRef[] = [...input];

  while (queue.length > 0) {
    const ref = queue.shift();
    if (!ref) {
      continue;
    }
    const configured = asConfigured(ref);
    const ext = configured.extension;
    if (!discovered.has(ext.name)) {
      discovered.set(ext.name, ext);
      for (const dep of ext.dependencies ?? []) {
        queue.push(dep);
      }
    }
  }

  return Array.from(discovered.values());
}

function topoSort(extensions: ReactorExtension<any, any, any>[]): ReactorExtension<any, any, any>[] {
  const byName = new Map(extensions.map((ext) => [ext.name, ext]));
  const temp = new Set<string>();
  const perm = new Set<string>();
  const ordered: ReactorExtension<any, any, any>[] = [];

  function visit(name: string) {
    if (perm.has(name)) {
      return;
    }
    if (temp.has(name)) {
      throw new Error(`Circular dependency detected at ${name}`);
    }
    temp.add(name);
    const ext = byName.get(name);
    if (!ext) {
      throw new Error(`Unknown extension ${name}`);
    }
    for (const dep of ext.dependencies ?? []) {
      const depName = asConfigured(dep).extension.name;
      visit(depName);
    }
    temp.delete(name);
    perm.add(name);
    ordered.push(ext);
  }

  for (const ext of extensions) {
    visit(ext.name);
  }

  return ordered;
}

function collectOverrides(input: ExtensionRef[]): Map<string, object> {
  const out = new Map<string, object>();
  const queue = [...input];

  while (queue.length > 0) {
    const ref = queue.shift();
    if (!ref) {
      continue;
    }
    const configured = asConfigured(ref);
    const name = configured.extension.name;
    const previous = (out.get(name) ?? {}) as Record<string, unknown>;
    const merged = shallowMergeConfig(previous, configured.config as Record<string, unknown>);
    out.set(name, merged);

    for (const dep of configured.extension.dependencies ?? []) {
      queue.push(dep);
    }
  }

  return out;
}

export function buildPlatformFromExtensions(
  extensionsInput: ExtensionRef[],
  options: BuildOptions = {},
): ReactorPlatform {
  const allExtensions = normalizeExtensions(extensionsInput);
  const orderedExtensions = topoSort(allExtensions);
  const byName = new Map(orderedExtensions.map((ext) => [ext.name, ext]));
  const configOverrides = collectOverrides(extensionsInput);

  const state = new Map<string, ExtensionRuntimeState<any, any, any>>();
  const listeners = new Set<() => void>();
  let revision = 0;

  function emitChange() {
    revision += 1;
    for (const listener of listeners) {
      listener();
    }
  }

  for (const ext of orderedExtensions) {
    const mergedConfig = mergeWithDefaults(ext, (configOverrides.get(ext.name) ?? {}) as never);
    state.set(ext.name, {
      extension: ext,
      config: mergedConfig,
      enabled: true,
    });
  }

  for (const ext of orderedExtensions) {
    for (const conflict of ext.conflictsWith ?? []) {
      if (byName.has(conflict)) {
        throw new Error(`Extension ${ext.name} conflicts with ${conflict}`);
      }
    }
    for (const peer of ext.peerDependencies ?? []) {
      if (!peer.optional && !byName.has(peer.name) && options.strictPeerDependencies) {
        throw new Error(`Missing required peer dependency ${peer.name} for ${ext.name}`);
      }
    }
  }

  const platformView: ReactorPlatformView = {
    hasExtension(name) {
      return state.has(name);
    },
    getOutput<T = unknown>(name: string): T | undefined {
      return state.get(name)?.outputValue as T | undefined;
    },
    getRequiredBackendPlugins(name: string): string[] {
      return state.get(name)?.extension.requiredBackendPlugins ?? [];
    },
    isEnabled(name: string): boolean {
      return state.get(name)?.enabled ?? false;
    },
  };

  function runInitAndBuild(name: string) {
    const current = state.get(name);
    if (!current) {
      throw new Error(`Unknown extension ${name}`);
    }
    const ctx = {
      extension: current.extension,
      config: current.config,
      state: {
        getConfig: () => current.config,
        getInit: () => current.initValue,
        getOutput: () => current.outputValue,
      },
      platform: platformView,
    };
    current.initValue = current.extension.init?.(ctx);
    current.outputValue = current.extension.build?.(ctx);
  }

  function runRegister(name: string) {
    const current = state.get(name);
    if (!current || !current.enabled) {
      return;
    }
    const ctx = {
      extension: current.extension,
      config: current.config,
      state: {
        getConfig: () => current.config,
        getInit: () => current.initValue,
        getOutput: () => current.outputValue,
      },
      platform: platformView,
    };
    current.registerDispose = current.extension.register?.(ctx) ?? undefined;
    current.afterDispose = current.extension.afterRegistration?.(ctx) ?? undefined;
  }

  function stopExtension(name: string) {
    const current = state.get(name);
    if (!current) {
      return;
    }
    current.afterDispose?.();
    current.afterDispose = undefined;
    current.registerDispose?.();
    current.registerDispose = undefined;
  }

  return {
    ...platformView,
    start() {
      for (const ext of orderedExtensions) {
        runInitAndBuild(ext.name);
      }
      for (const ext of orderedExtensions) {
        runRegister(ext.name);
      }
      emitChange();
    },
    stop() {
      for (const ext of [...orderedExtensions].reverse()) {
        stopExtension(ext.name);
      }
      emitChange();
    },
    enable(name: string) {
      const current = state.get(name);
      if (!current) {
        throw new Error(`Unknown extension ${name}`);
      }
      if (current.enabled) {
        return;
      }
      current.enabled = true;
      runInitAndBuild(name);
      runRegister(name);
      emitChange();
    },
    disable(name: string) {
      const current = state.get(name);
      if (!current) {
        throw new Error(`Unknown extension ${name}`);
      }
      if (!current.enabled) {
        return;
      }
      stopExtension(name);
      current.enabled = false;
      emitChange();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    listExtensions() {
      return orderedExtensions.map((ext) => ext.name);
    },
    getConfig<C = unknown>(name: string): C | undefined {
      return state.get(name)?.config as C | undefined;
    },
    getRevision() {
      return revision;
    },
  };
}
