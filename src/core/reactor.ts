/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import {
  asConfigured,
  Dispose,
  ExtensionMetadata,
  ExtensionRef,
  isLazyExtensionRef,
  LazyExtensionRef,
  mergeWithDefaults,
  ReactorExtension,
  ReactorPlatformView,
} from './extension';
import {
  ContributionRegistry,
  type ContributeOptions,
  type Contribution,
  type ExtensionPoint,
} from './contributions';

type ExtensionRuntimeState<C, I, O> = {
  extension: ReactorExtension<C, I, O>;
  config: C;
  enabled: boolean;
  initValue?: I;
  outputValue?: O;
  registerDispose?: Dispose;
  afterDispose?: Dispose;
  /** Set while this is a lazy extension whose module has not arrived. */
  lazy?: LazyExtensionRef;
  /** False only for a lazy extension still waiting for its module. */
  loaded: boolean;
  /** What went wrong fetching the module, if it did. */
  loadError?: Error;
  /**
   * The in-flight fetch, kept so a second `start()` joins it rather than
   * fetching the module again. React's StrictMode does exactly that:
   * start, stop, start.
   */
  loading?: Promise<unknown>;
};

/** A reference the platform accepts: eager, configured, or lazy. */
export type PlatformExtensionRef = ExtensionRef | LazyExtensionRef;

/**
 * The placeholder that stands in for a lazy extension until its module lands.
 *
 * It carries everything declared up-front and none of the phases, so the
 * reactor can order it, list it and describe it while there is still nothing
 * to run.
 */
function placeholderFor(ref: LazyExtensionRef): ReactorExtension<any, any, any> {
  return {
    name: ref.name,
    version: ref.version,
    displayName: ref.displayName,
    description: ref.description,
    octicon: ref.octicon,
    emoji: ref.emoji,
    dependencies: ref.dependencies,
    requiredBackendPlugins: ref.requiredBackendPlugins,
    optionalBackendPlugins: ref.optionalBackendPlugins,
    extensionPoints: ref.extensionPoints,
  };
}

/**
 * The loaded module, with anything it left unsaid filled in from the
 * declaration. What the module says wins: the up-front copy exists so a host
 * has something to show first, not to override the real thing.
 */
function mergeLoaded(
  ref: LazyExtensionRef,
  loaded: ReactorExtension<any, any, any>,
): ReactorExtension<any, any, any> {
  return {
    ...loaded,
    displayName: loaded.displayName ?? ref.displayName,
    description: loaded.description ?? ref.description,
    octicon: loaded.octicon ?? ref.octicon,
    emoji: loaded.emoji ?? ref.emoji,
    version: loaded.version ?? ref.version,
    requiredBackendPlugins:
      loaded.requiredBackendPlugins ?? ref.requiredBackendPlugins,
    optionalBackendPlugins:
      loaded.optionalBackendPlugins ?? ref.optionalBackendPlugins,
    extensionPoints: loaded.extensionPoints ?? ref.extensionPoints,
  };
}

export type BuildOptions = {
  strictPeerDependencies?: boolean;
};

export type ReactorPlatform = ReactorPlatformView & {
  /**
   * Activate everything already loaded, then fetch the lazy ones.
   *
   * Returns as soon as the eager extensions are registered — the point of the
   * split. Lazy modules are fetched afterwards and activate as they arrive,
   * each waking subscribers, so the first paint waits for nothing that has yet
   * to be downloaded. Await {@link ReactorPlatform.whenReady} for the rest.
   */
  start: () => void;
  /** Resolves when every lazy extension has loaded and activated, or failed. */
  whenReady: () => Promise<void>;
  stop: () => void;
  enable: (name: string) => void;
  disable: (name: string) => void;
  subscribe: (listener: () => void) => () => void;
  listExtensions: () => string[];
  getConfig: <C = unknown>(name: string) => C | undefined;
  /** Every point that holds something, and what each holds. */
  describeContributions: () => { point: string; contributions: Contribution<unknown>[] }[];
  /** The dependency graph of this extension, by name. */
  getDependencies: (name: string) => string[];
  /**
   * Monotonically increasing revision that changes on every reactor mutation
   * (start, stop, enable, disable). External subscribers (e.g. the React
   * bridge) can use it as a stable snapshot value so they re-render whenever
   * the reactor changes — including when `start()` populates build outputs
   * without changing any extension's enabled flag.
   */
  getRevision: () => number;
};

export function shallowMergeConfig<C>(base: C, override: Partial<C>): C {
  return { ...(base as object), ...(override as object) } as C;
}

function normalizeExtensions(input: PlatformExtensionRef[]): {
  extensions: ReactorExtension<any, any, any>[];
  lazyByName: Map<string, LazyExtensionRef>;
} {
  const discovered = new Map<string, ReactorExtension<any, any, any>>();
  const lazyByName = new Map<string, LazyExtensionRef>();
  const queue: PlatformExtensionRef[] = [...input];

  while (queue.length > 0) {
    const ref = queue.shift();
    if (!ref) {
      continue;
    }
    // A lazy reference stands in for an extension that does not exist yet:
    // discovery walks its declared dependencies, not the module's.
    if (isLazyExtensionRef(ref)) {
      if (!discovered.has(ref.name)) {
        lazyByName.set(ref.name, ref);
        discovered.set(ref.name, placeholderFor(ref));
        for (const dep of ref.dependencies ?? []) {
          queue.push(dep);
        }
      }
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

  return { extensions: Array.from(discovered.values()), lazyByName };
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

function collectOverrides(input: PlatformExtensionRef[]): Map<string, object> {
  const out = new Map<string, object>();
  const queue: PlatformExtensionRef[] = [...input];

  while (queue.length > 0) {
    const ref = queue.shift();
    if (!ref) {
      continue;
    }
    if (isLazyExtensionRef(ref)) {
      // Nothing to configure until the module is here; its dependencies still
      // need walking, since they may be configured.
      for (const dep of ref.dependencies ?? []) {
        queue.push(dep);
      }
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

export function buildReactorFromExtensions(
  extensionsInput: PlatformExtensionRef[],
  options: BuildOptions = {},
): ReactorPlatform {
  const { extensions: allExtensions, lazyByName } = normalizeExtensions(extensionsInput);
  const orderedExtensions = topoSort(allExtensions);
  const byName = new Map(orderedExtensions.map((ext) => [ext.name, ext]));
  const configOverrides = collectOverrides(extensionsInput);

  const state = new Map<string, ExtensionRuntimeState<any, any, any>>();
  const listeners = new Set<() => void>();
  const contributions = new ContributionRegistry();
  let revision = 0;
  let mutationDepth = 0;
  /** The in-flight lazy pass, so `whenReady` can be awaited more than once. */
  let readyPromise: Promise<void> | undefined;

  function emitChange() {
    // Inside a batch there is nothing to do: the outermost `asOneChange`
    // emits once on the way out, whatever happened in between.
    if (mutationDepth > 0) {
      return;
    }
    revision += 1;
    for (const listener of listeners) {
      listener();
    }
  }

  /**
   * Run a lifecycle operation as one change. Without this, a plugin
   * contributing five views during `register` would wake every subscriber five
   * times before the reactor had even finished starting.
   *
   * The outermost batch always emits: `start`, `stop`, `enable` and `disable`
   * are changes by definition, whether or not anything was contributed.
   */
  function asOneChange<T>(operation: () => T): T {
    mutationDepth += 1;
    try {
      return operation();
    } finally {
      mutationDepth -= 1;
      if (mutationDepth === 0) {
        emitChange();
      }
    }
  }

  for (const ext of orderedExtensions) {
    const mergedConfig = mergeWithDefaults(ext, (configOverrides.get(ext.name) ?? {}) as never);
    state.set(ext.name, {
      extension: ext,
      config: mergedConfig,
      enabled: true,
      lazy: lazyByName.get(ext.name),
      loaded: !lazyByName.has(ext.name),
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

  const reactorView: ReactorPlatformView = {
    hasExtension(name) {
      return state.has(name);
    },
    getOutput<T = unknown>(name: string): T | undefined {
      return state.get(name)?.outputValue as T | undefined;
    },
    getRequiredBackendPlugins(name: string): string[] {
      return state.get(name)?.extension.requiredBackendPlugins ?? [];
    },
    getOptionalBackendPlugins(name: string): string[] {
      return state.get(name)?.extension.optionalBackendPlugins ?? [];
    },
    getMetadata(name: string): ExtensionMetadata | undefined {
      const current = state.get(name);
      if (!current) {
        return undefined;
      }
      const { extension } = current;
      return {
        name: extension.name,
        version: extension.version,
        // The identifier is the fallback: a host should always have something
        // to print, and `@music/catalog` beats an empty line.
        displayName: extension.displayName ?? extension.name,
        description: extension.description,
        octicon: extension.octicon,
        emoji: extension.emoji,
        requiredBackendPlugins: extension.requiredBackendPlugins ?? [],
        optionalBackendPlugins: extension.optionalBackendPlugins ?? [],
        loaded: current.loaded,
        lazy: Boolean(current.lazy),
        extensionPoints: (extension.extensionPoints ?? []).map((point) => point.id),
      };
    },
    isEnabled(name: string): boolean {
      return state.get(name)?.enabled ?? false;
    },
    getContributions<T>(point: ExtensionPoint<T>): Contribution<T>[] {
      // Contributions are disposed when an extension stops, so anything still
      // stored belongs to a live extension — no filtering needed here.
      return contributions.get(point);
    },
  };

  function buildPhaseContext(
    name: string,
    current: ExtensionRuntimeState<any, any, any>,
  ) {
    return {
      extension: current.extension,
      config: current.config,
      state: {
        getConfig: () => current.config,
        getInit: () => current.initValue,
        getOutput: () => current.outputValue,
      },
      reactor: reactorView,
      contribute<T>(
        point: ExtensionPoint<T>,
        value: T,
        options?: ContributeOptions,
      ): Dispose {
        const dispose = contributions.add(name, point, value, options);
        emitChange();

        // The registry's disposer is already idempotent; the notification has
        // to be too. A second call removes nothing, so waking every subscriber
        // again would be pure noise — and in React, a re-render for no change.
        let disposed = false;
        return () => {
          if (disposed) {
            return;
          }
          disposed = true;
          dispose();
          emitChange();
        };
      },
    };
  }

  function runInitAndBuild(name: string) {
    const current = state.get(name);
    if (!current) {
      throw new Error(`Unknown extension ${name}`);
    }
    if (!current.loaded) {
      // Nothing to build yet: the module is still on the wire, and activation
      // is the loader's job the moment it lands.
      return;
    }
    const ctx = buildPhaseContext(name, current);
    current.initValue = current.extension.init?.(ctx);
    current.outputValue = current.extension.build?.(ctx);
  }

  function runRegister(name: string) {
    const current = state.get(name);
    if (!current || !current.enabled || !current.loaded) {
      return;
    }
    const ctx = buildPhaseContext(name, current);

    // Declarative contributions are applied before `register` runs, so an
    // extension's own register hook already sees a fully populated point.
    for (const record of current.extension.contributes ?? []) {
      contributions.add(name, record.point, record.value, record.options);
    }
    emitChange();

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
    // Whatever it contributed goes with it: a disabled extension must not keep
    // a view in the switcher or a command in the palette.
    contributions.disposeExtension(name);
  }

  /**
   * Fetch every lazy module, then activate them in dependency order.
   *
   * Fetching is parallel and activation is serial, on purpose: one slow module
   * must not hold up the others' downloads, but a dependant must never
   * activate before what it depends on. Each activation is its own change, so
   * the UI fills in plugin by plugin rather than in one late jump.
   */
  async function loadLazyExtensions(): Promise<void> {
    const pending = orderedExtensions.filter((ext) => {
      const current = state.get(ext.name);
      return current?.lazy && !current.loaded;
    });
    if (pending.length === 0) {
      return;
    }

    for (const ext of pending) {
      const current = state.get(ext.name)!;
      // Started here rather than in the loop below: the loop awaits in
      // order, and awaiting a promise that has not been created yet would
      // serialise the network too. Reused when it already exists, so
      // overlapping passes share one fetch.
      current.loading ??= Promise.resolve().then(() => current.lazy!.load());
    }

    for (const ext of pending) {
      const current = state.get(ext.name)!;
      try {
        const module = await current.loading!;
        if (current.loaded) {
          // Another pass got here first — two `start()` calls overlapping, as
          // StrictMode's start/stop/start produces. Activating again would
          // register everything this extension contributes a second time.
          continue;
        }
        const loaded =
          (module as { default?: ReactorExtension<any, any, any> }).default ??
          (module as ReactorExtension<any, any, any>);
        if (!loaded || typeof loaded !== 'object' || !loaded.name) {
          throw new Error(`Lazy extension ${ext.name} did not resolve to an extension`);
        }
        current.extension = mergeLoaded(current.lazy!, loaded);
        current.config = mergeWithDefaults(
          current.extension,
          (configOverrides.get(ext.name) ?? {}) as never,
        );
        current.loaded = true;
        asOneChange(() => {
          if (current.enabled) {
            runInitAndBuild(ext.name);
            runRegister(ext.name);
          }
        });
      } catch (error) {
        // One plugin that cannot be fetched is one plugin missing, not a dead
        // platform: the failure is recorded and everything else carries on.
        current.loadError = error instanceof Error ? error : new Error(String(error));
        emitChange();
      }
    }
  }

  return {
    ...reactorView,
    start() {
      asOneChange(() => {
        for (const ext of orderedExtensions) {
          runInitAndBuild(ext.name);
        }
        for (const ext of orderedExtensions) {
          runRegister(ext.name);
        }
      });
      // After the eager pass, never before it: a fetch between `start()` and
      // the first paint is exactly what this split exists to avoid.
      readyPromise = loadLazyExtensions();
    },
    whenReady() {
      return readyPromise ?? Promise.resolve();
    },
    stop() {
      asOneChange(() => {
        for (const ext of [...orderedExtensions].reverse()) {
          stopExtension(ext.name);
        }
      });
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
      if (!current.loaded) {
        // The loader activates it when the module lands, and it now knows to.
        emitChange();
        return;
      }
      asOneChange(() => {
        // An extension that owns something says so, and keeps it: rebuilding
        // would hand back a new instance while everything that captured the
        // old one carries on holding a detached object.
        const keepsWhatItBuilt =
          current.extension.preserveOutput && current.outputValue !== undefined;
        if (!keepsWhatItBuilt) {
          runInitAndBuild(name);
        }
        runRegister(name);
      });
    },
    disable(name: string) {
      const current = state.get(name);
      if (!current) {
        throw new Error(`Unknown extension ${name}`);
      }
      if (!current.enabled) {
        return;
      }
      current.enabled = false;
      asOneChange(() => {
        stopExtension(name);
      });
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
    describeContributions() {
      return contributions.describe();
    },
    getDependencies(name: string): string[] {
      return (state.get(name)?.extension.dependencies ?? []).map(
        (dep) => asConfigured(dep).extension.name,
      );
    },
    getRevision() {
      return revision;
    },
  };
}
