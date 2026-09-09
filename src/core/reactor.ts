/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The reactor: what provides contribution points, and what activates plugins.
 *
 * It accepts plugins and extensions, orders them by dependency, activates them
 * when their activation events fire, and holds the contributions they make
 * until they are disabled or stopped.
 *
 * @module core/reactor
 */

import {
  asConfigured,
  Dispose,
  PluginManifest,
  PluginRef,
  isLazyPluginRef,
  LazyPluginRef,
  mergeWithDefaults,
  ReactorPlugin,
  ReactorPlatformView,
} from './plugin';
import {
  ContributionRegistry,
  type ContributeOptions,
  type Contribution,
  type ContributionPoint,
} from './contributions';
import { CommandRegistry } from './commands';
import type { ReactorCommand, RegisteredCommand } from './commands';
import {
  activatesAtStartup,
  matchesActivation,
  matchesDeactivation,
  onContributionPoint,
  ON_STARTUP,
  type ActivationEvent,
} from './activation';
import { isExtension, type ExtensionManifest, type ReactorExtension } from './extension';
import { resolveGate, type Gate, type GateVerdict } from './gates';

type PluginRuntimeState<C, I, O> = {
  plugin: ReactorPlugin<C, I, O>;
  config: C;
  enabled: boolean;
  initValue?: I;
  outputValue?: O;
  registerDispose?: Dispose;
  afterDispose?: Dispose;
  /** Set while this is a lazy plugin whose module has not arrived. */
  lazy?: LazyPluginRef;
  /** False only for a lazy plugin still waiting for its module. */
  loaded: boolean;
  /**
   * Whether its phases have run.
   *
   * Distinct from `loaded` (the module is here) and from `enabled` (nobody has
   * switched it off): a plugin can be loaded, enabled, and still inactive
   * because the event it waits on has not happened.
   */
  activated: boolean;
  /**
   * Why it is switched off, when it is.
   *
   * `'user'` — somebody moved a switch, and it stays where they put it.
   * `'dependency'` — it was taken down with something it depends on, and it
   * comes back when that does. Collapse the two and enabling a dependency
   * either silently overrides a person's decision or strands everything that
   * needed it. Same distinction as deactivated-versus-disabled, one level up.
   */
  disabledBy?: 'user' | 'dependency';
  /** The extension that delivered it, when one did. */
  extension?: string;
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
export type PlatformPluginRef = PluginRef | LazyPluginRef;

/**
 * What `buildReactorFromPlugins` takes: plugins, or extensions grouping them.
 *
 * Both, in one list, on purpose — an application assembles itself from a few
 * extensions and a handful of loose plugins, and should not have to sort them
 * into two arguments to say so.
 */
export type PlatformInput = PlatformPluginRef | ReactorExtension;

/**
 * The placeholder that stands in for a lazy plugin until its module lands.
 *
 * It carries everything declared up-front and none of the phases, so the
 * reactor can order it, list it and describe it while there is still nothing
 * to run.
 */
function placeholderFor(ref: LazyPluginRef): ReactorPlugin<any, any, any> {
  return {
    name: ref.name,
    version: ref.version,
    displayName: ref.displayName,
    description: ref.description,
    octicon: ref.octicon,
    emoji: ref.emoji,
    dependencies: ref.dependencies,
    activationEvents: ref.activationEvents,
    deactivationEvents: ref.deactivationEvents,
    requiredBackendPlugins: ref.requiredBackendPlugins,
    optionalBackendPlugins: ref.optionalBackendPlugins,
    contributionPoints: ref.contributionPoints,
  };
}

/**
 * The loaded module, with anything it left unsaid filled in from the
 * declaration. What the module says wins: the up-front copy exists so a host
 * has something to show first, not to override the real thing.
 */
function mergeLoaded(
  ref: LazyPluginRef,
  loaded: ReactorPlugin<any, any, any>,
): ReactorPlugin<any, any, any> {
  return {
    ...loaded,
    displayName: loaded.displayName ?? ref.displayName,
    description: loaded.description ?? ref.description,
    octicon: loaded.octicon ?? ref.octicon,
    emoji: loaded.emoji ?? ref.emoji,
    version: loaded.version ?? ref.version,
    activationEvents: loaded.activationEvents ?? ref.activationEvents,
    deactivationEvents: loaded.deactivationEvents ?? ref.deactivationEvents,
    requiredBackendPlugins:
      loaded.requiredBackendPlugins ?? ref.requiredBackendPlugins,
    optionalBackendPlugins:
      loaded.optionalBackendPlugins ?? ref.optionalBackendPlugins,
    contributionPoints: loaded.contributionPoints ?? ref.contributionPoints,
  };
}

export type BuildOptions = {
  strictPeerDependencies?: boolean;
};

/** What one fired event changed, in the order it happened. */
export type FiredEvent = {
  /** Plugins stood down, dependants first. */
  deactivated: string[];
  /** Plugins brought up, dependencies first. */
  activated: string[];
};

export type ReactorPlatform = ReactorPlatformView & {
  /**
   * Activate every plugin whose activation events include startup, then fetch
   * the lazy ones among them.
   *
   * Returns as soon as the eager plugins are registered — the point of the
   * split. Lazy modules are fetched afterwards and activate as they arrive,
   * each waking subscribers, so the first paint waits for nothing that has yet
   * to be downloaded. Await {@link ReactorPlatform.whenReady} for the rest.
   *
   * A plugin waiting on any other event is not touched here; it activates when
   * {@link ReactorPlatform.fire} says so, or when somebody reads a point it
   * was waiting on.
   */
  start: () => void;
  /** Resolves when every lazy plugin due at startup has activated, or failed. */
  whenReady: () => Promise<void>;
  /**
   * Fire an event: stand down whatever was waiting to, then load and activate
   * whatever was waiting for it.
   *
   * Deactivation runs first, so one event can retire the old thing and bring
   * up the new — `onView:notebook` taking the document's plugins down and the
   * notebook's up is one call, not two.
   *
   * Resolves with what changed. Firing an event nobody waits on is free and
   * does nothing, which is what lets an application fire liberally — on every
   * view change — without checking first.
   */
  fire: (event: ActivationEvent) => Promise<FiredEvent>;
  /**
   * Stand a plugin down: run its disposers, drop its contributions, and let it
   * come back the next time one of its activation events fires.
   *
   * Not the same as `disable`. Disabling is a person's decision and it sticks —
   * no event revives a disabled plugin. This says only that the reason for
   * running has passed, so the plugin keeps its place in the list and its
   * module, and is eligible to activate again.
   *
   * Anything that depends on it is stood down first: a dependant left running
   * against a deactivated dependency is holding an output nobody maintains.
   */
  deactivate: (name: string) => void;
  /**
   * Tell the platform which backend plugins are running, and let activation
   * follow.
   *
   * `requiredBackendPlugins` has always gated *rendering*: a slot component
   * whose backend plugin is switched off does not draw. That leaves the plugin
   * itself activated, holding contributions backed by a server that is no
   * longer answering — the plugin list says it is on while nothing it offers
   * works.
   *
   * This closes that. A plugin whose required backend plugin goes away is
   * stood down, dependants first, exactly as any other deactivation; when the
   * backend plugin returns, so does it. What crosses the wire is
   * *deactivation*, never *disabling* — a server must not be able to undo
   * somebody's checkbox, so a plugin a person switched off stays off.
   *
   * Call it whenever the answer changes: from a poll, from an SSE stream, or
   * once at startup. Firing it with an unchanged list is free.
   */
  setBackendPlugins: (available: readonly string[]) => Promise<FiredEvent>;
  /**
   * Add a plugin — or an extension of them — to a platform that is already
   * running.
   *
   * `buildReactorFromPlugins` takes the set an application was built with.
   * This is for the set it did not know about: a remote fetched from a URL a
   * person typed in, an extension the server reported after a `pip install`,
   * anything a marketplace hands over. Without it, "install a plugin" means
   * rebuilding the platform, which restarts every plugin already in it.
   *
   * The new plugins are ordered against the existing ones rather than appended,
   * so one that depends on something already installed still activates after
   * it. Installing a name that is already here is a no-op, not an error —
   * asking twice is what a retry looks like.
   *
   * Resolves with the names actually installed, dependencies first.
   */
  install: (input: PlatformInput) => Promise<string[]>;
  stop: () => void;
  enable: (name: string) => void;
  disable: (name: string) => void;
  subscribe: (listener: () => void) => () => void;
  listPlugins: () => string[];
  /** The extensions that delivered plugins to this platform, by name. */
  listExtensions: () => string[];
  /** An extension's presentation and the plugins it delivered. */
  getExtensionManifest: (name: string) => ExtensionManifest | undefined;
  getConfig: <C = unknown>(name: string) => C | undefined;
  /** Every point that holds something, and what each holds. */
  describeContributions: () => { point: string; contributions: Contribution<unknown>[] }[];
  /**
   * Every command registered by an enabled plugin, ordered by `order` then by
   * registration order.
   *
   * A snapshot: commands registered later show up on the next revision, which
   * is what every host is already subscribed to.
   */
  listCommands: () => RegisteredCommand[];
  /** One command by id, or `undefined`. */
  getCommand: (id: string) => RegisteredCommand | undefined;
  /**
   * Run a command by id. Rejects if there is no such command, if it is
   * currently unavailable, or if the command itself throws — the caller
   * decides what a failed command looks like, because only it knows where to
   * say so. Resolves with what the command returned, which is how a command
   * that doubles as an agent's tool answers the agent.
   */
  executeCommand: <A = void, R = unknown>(id: string, argument?: A) => Promise<R>;
  /** The dependency graph of this plugin, by name. */
  getDependencies: (name: string) => string[];
  /**
   * Monotonically increasing revision that changes on every reactor mutation
   * (start, stop, enable, disable, activation). External subscribers (e.g. the
   * React bridge) can use it as a stable snapshot value so they re-render
   * whenever the reactor changes — including when `start()` populates build
   * outputs without changing any plugin's enabled flag.
   */
  getRevision: () => number;
};

export function shallowMergeConfig<C>(base: C, override: Partial<C>): C {
  return { ...(base as object), ...(override as object) } as C;
}

/**
 * Flatten the input to plugins, remembering which extension delivered each.
 *
 * An extension is unwrapped here and never seen again: from this point the
 * reactor deals only in plugins, and the grouping survives as a name on the
 * manifest. See `core/extension` for why it is deliberately that thin.
 */
function normalizePlugins(input: PlatformInput[]): {
  plugins: ReactorPlugin<any, any, any>[];
  lazyByName: Map<string, LazyPluginRef>;
  extensionOf: Map<string, string>;
  extensions: Map<string, ReactorExtension>;
} {
  const discovered = new Map<string, ReactorPlugin<any, any, any>>();
  const lazyByName = new Map<string, LazyPluginRef>();
  const extensionOf = new Map<string, string>();
  const extensions = new Map<string, ReactorExtension>();
  // Each entry carries the extension it arrived under, if any — a dependency
  // of a grouped plugin is not itself grouped unless it was declared so.
  const queue: { ref: PlatformInput; from?: string }[] = input.map((ref) => ({ ref }));

  while (queue.length > 0) {
    const entry = queue.shift();
    if (!entry?.ref) {
      continue;
    }
    const { ref, from } = entry;

    if (isExtension(ref)) {
      extensions.set(ref.name, ref);
      for (const member of ref.plugins) {
        queue.push({ ref: member, from: ref.name });
      }
      continue;
    }

    // A lazy reference stands in for a plugin that does not exist yet:
    // discovery walks its declared dependencies, not the module's.
    if (isLazyPluginRef(ref)) {
      if (!discovered.has(ref.name)) {
        lazyByName.set(ref.name, ref);
        discovered.set(ref.name, placeholderFor(ref));
        if (from) {
          extensionOf.set(ref.name, from);
        }
        for (const dep of ref.dependencies ?? []) {
          queue.push({ ref: dep });
        }
      }
      continue;
    }

    const configured = asConfigured(ref);
    const plugin = configured.plugin;
    if (!discovered.has(plugin.name)) {
      discovered.set(plugin.name, plugin);
      if (from) {
        extensionOf.set(plugin.name, from);
      }
      for (const dep of plugin.dependencies ?? []) {
        queue.push({ ref: dep });
      }
    }
  }

  return { plugins: Array.from(discovered.values()), lazyByName, extensionOf, extensions };
}

function topoSort(plugins: ReactorPlugin<any, any, any>[]): ReactorPlugin<any, any, any>[] {
  const byName = new Map(plugins.map((plugin) => [plugin.name, plugin]));
  const temp = new Set<string>();
  const perm = new Set<string>();
  const ordered: ReactorPlugin<any, any, any>[] = [];

  function visit(name: string) {
    if (perm.has(name)) {
      return;
    }
    if (temp.has(name)) {
      throw new Error(`Circular dependency detected at ${name}`);
    }
    temp.add(name);
    const plugin = byName.get(name);
    if (!plugin) {
      throw new Error(`Unknown plugin ${name}`);
    }
    for (const dep of plugin.dependencies ?? []) {
      visit(asConfigured(dep).plugin.name);
    }
    temp.delete(name);
    perm.add(name);
    ordered.push(plugin);
  }

  for (const plugin of plugins) {
    visit(plugin.name);
  }

  return ordered;
}

function collectOverrides(input: PlatformInput[]): Map<string, object> {
  const out = new Map<string, object>();
  const queue: PlatformInput[] = [...input];

  while (queue.length > 0) {
    const ref = queue.shift();
    if (!ref) {
      continue;
    }
    if (isExtension(ref)) {
      queue.push(...ref.plugins);
      continue;
    }
    if (isLazyPluginRef(ref)) {
      // Nothing to configure until the module is here; its dependencies still
      // need walking, since they may be configured.
      for (const dep of ref.dependencies ?? []) {
        queue.push(dep);
      }
      continue;
    }
    const configured = asConfigured(ref);
    const name = configured.plugin.name;
    const previous = (out.get(name) ?? {}) as Record<string, unknown>;
    const merged = shallowMergeConfig(previous, configured.config as Record<string, unknown>);
    out.set(name, merged);

    for (const dep of configured.plugin.dependencies ?? []) {
      queue.push(dep);
    }
  }

  return out;
}

export function buildReactorFromPlugins(
  pluginsInput: PlatformInput[],
  options: BuildOptions = {},
): ReactorPlatform {
  const {
    plugins: allPlugins,
    lazyByName,
    extensionOf,
    extensions,
  } = normalizePlugins(pluginsInput);
  const orderedPlugins = topoSort(allPlugins);
  const byName = new Map(orderedPlugins.map((plugin) => [plugin.name, plugin]));
  const configOverrides = collectOverrides(pluginsInput);

  const state = new Map<string, PluginRuntimeState<any, any, any>>();
  const listeners = new Set<() => void>();
  const contributions = new ContributionRegistry();
  const commands = new CommandRegistry();
  let revision = 0;
  let mutationDepth = 0;
  /** The in-flight startup pass, so `whenReady` can be awaited more than once. */
  let readyPromise: Promise<void> | undefined;
  /**
   * Whether `start` has run.
   *
   * `install` needs it: a plugin installed before the platform starts should
   * wait for the same startup pass as everything else, and one installed
   * afterwards has missed that pass and must be activated on its own.
   */
  let started = false;
  /** Activations in flight, by plugin, so two events never activate one twice. */
  const activating = new Map<string, Promise<void>>();
  /** Points already read at least once, so an event is fired once per point. */
  const firedPoints = new Set<string>();
  /**
   * Plugins stood down because a backend plugin went away.
   *
   * Kept so that only what this took down comes back. A plugin deactivated for
   * some other reason — an event, a direct call — is not revived by a server
   * reappearing, for the same reason a disabled one never is.
   */
  const standingDownForBackend = new Set<string>();
  /** The backend plugins last reported as running. */
  let availableBackendPlugins: ReadonlySet<string> = new Set();

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

  for (const plugin of orderedPlugins) {
    const mergedConfig = mergeWithDefaults(
      plugin,
      (configOverrides.get(plugin.name) ?? {}) as never,
    );
    state.set(plugin.name, {
      plugin,
      config: mergedConfig,
      enabled: true,
      activated: false,
      extension: extensionOf.get(plugin.name),
      lazy: lazyByName.get(plugin.name),
      loaded: !lazyByName.has(plugin.name),
    });
  }

  for (const plugin of orderedPlugins) {
    for (const conflict of plugin.conflictsWith ?? []) {
      if (byName.has(conflict)) {
        throw new Error(`Plugin ${plugin.name} conflicts with ${conflict}`);
      }
    }
    for (const peer of plugin.peerDependencies ?? []) {
      if (!peer.optional && !byName.has(peer.name) && options.strictPeerDependencies) {
        throw new Error(`Missing required peer dependency ${peer.name} for ${plugin.name}`);
      }
    }
  }

  /** Plugins not yet activated that are waiting on this event. */
  function waitingFor(event: ActivationEvent): string[] {
    const waiting: string[] = [];
    for (const plugin of orderedPlugins) {
      const current = state.get(plugin.name);
      if (!current || current.activated) {
        continue;
      }
      if (matchesActivation(current.plugin.activationEvents, event)) {
        waiting.push(plugin.name);
      }
    }
    return waiting;
  }

  /**
   * Read a point, firing its activation event the first time.
   *
   * A free function rather than a method, because `checkGate` needs it too and
   * `this` cannot be relied on: the platform spreads this view into a new
   * object, and a host that destructures `const { checkGate } = reactor` would
   * lose the receiver.
   */
  function readContributions<T>(point: ContributionPoint<T>): Contribution<T>[] {
    // Reading a point is itself an activation event: a plugin that only
    // matters once somebody looks here loads exactly now, and whoever looked
    // never had to know it existed. Fired once per point, and only when
    // something is actually waiting, so the common read stays a map lookup.
    if (!firedPoints.has(point.id)) {
      firedPoints.add(point.id);
      const event = onContributionPoint(point);
      if (waitingFor(event).length > 0) {
        // Deferred to a microtask, not merely un-awaited. Activating an eager
        // plugin runs its phases synchronously, and this read happens during a
        // React render — so activating inline would contribute, emit, and wake
        // every subscriber in the middle of rendering the component that
        // asked. The read answers with what is here now; the late arrivals
        // bump the revision, which is what every host is already subscribed to.
        void Promise.resolve().then(() => activateFor(event));
      }
    }
    // Contributions are disposed when a plugin stops, so anything still stored
    // belongs to a live plugin — no filtering needed here.
    return contributions.get(point);
  }

  const reactorView: ReactorPlatformView = {
    hasPlugin(name) {
      return state.has(name);
    },
    getOutput<T = unknown>(name: string): T | undefined {
      return state.get(name)?.outputValue as T | undefined;
    },
    getRequiredBackendPlugins(name: string): string[] {
      return state.get(name)?.plugin.requiredBackendPlugins ?? [];
    },
    getOptionalBackendPlugins(name: string): string[] {
      return state.get(name)?.plugin.optionalBackendPlugins ?? [];
    },
    getManifest(name: string): PluginManifest | undefined {
      const current = state.get(name);
      if (!current) {
        return undefined;
      }
      const { plugin } = current;
      return {
        name: plugin.name,
        version: plugin.version,
        // The identifier is the fallback: a host should always have something
        // to print, and `@music/catalog` beats an empty line.
        displayName: plugin.displayName ?? plugin.name,
        description: plugin.description,
        octicon: plugin.octicon,
        emoji: plugin.emoji,
        extension: current.extension,
        requiredBackendPlugins: plugin.requiredBackendPlugins ?? [],
        optionalBackendPlugins: plugin.optionalBackendPlugins ?? [],
        loaded: current.loaded,
        lazy: Boolean(current.lazy),
        activated: current.activated,
        disabledBy: current.enabled ? undefined : current.disabledBy ?? 'user',
        loadError: current.loadError?.message,
        activationEvents: plugin.activationEvents ?? [ON_STARTUP],
        deactivationEvents: plugin.deactivationEvents ?? [],
        contributionPoints: (plugin.contributionPoints ?? []).map((point) => point.id),
        // Only what is declared up-front, and only once the module is here: an
        // imperative `ctx.contribute` is not knowable before it runs, and the
        // graph reads those from the registry instead.
        contributesTo: [
          ...new Set((plugin.contributes ?? []).map((record) => record.point.id)),
        ],
      };
    },
    isEnabled(name: string): boolean {
      return state.get(name)?.enabled ?? false;
    },
    getContributions<T>(point: ContributionPoint<T>): Contribution<T>[] {
      return readContributions(point);
    },
    checkGate<C>(gate: Gate<C>, context: C): GateVerdict {
      return resolveGate(readContributions(gate), context);
    },
  };

  function buildPhaseContext(
    name: string,
    current: PluginRuntimeState<any, any, any>,
  ) {
    return {
      plugin: current.plugin,
      config: current.config,
      state: {
        getConfig: () => current.config,
        getInit: () => current.initValue,
        getOutput: () => current.outputValue,
      },
      reactor: reactorView,
      contribute<T>(
        point: ContributionPoint<T>,
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
      registerCommand<A, R = void>(command: ReactorCommand<A, R>): Dispose {
        const dispose = commands.add(name, command);
        emitChange();

        // Idempotent for the same reason `contribute`'s disposer is: a second
        // call removes nothing, and waking subscribers again is pure noise.
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
      throw new Error(`Unknown plugin ${name}`);
    }
    if (!current.loaded) {
      // Nothing to build yet: the module is still on the wire, and activation
      // is the loader's job the moment it lands.
      return;
    }
    const ctx = buildPhaseContext(name, current);
    current.initValue = current.plugin.init?.(ctx);
    current.outputValue = current.plugin.build?.(ctx);
  }

  function runRegister(name: string) {
    const current = state.get(name);
    if (!current || !current.enabled || !current.loaded) {
      return;
    }
    const ctx = buildPhaseContext(name, current);

    // Declarative contributions are applied before `register` runs, so a
    // plugin's own register hook already sees a fully populated point.
    for (const record of current.plugin.contributes ?? []) {
      contributions.add(name, record.point, record.value, record.options);
    }
    for (const command of current.plugin.commands ?? []) {
      commands.add(name, command);
    }
    emitChange();

    current.registerDispose = current.plugin.register?.(ctx) ?? undefined;
    current.afterDispose = current.plugin.afterRegistration?.(ctx) ?? undefined;
  }

  /**
   * Mark a loaded plugin's condition met, and run its phases if it may run.
   *
   * `activated` records the condition, not the running: a plugin switched off
   * still becomes activated, and `enable` is what runs its phases later. Two
   * flags rather than one because they answer different questions and a host
   * showing "waiting" and "off" as the same thing helps nobody.
   */
  function activateLoaded(name: string) {
    const current = state.get(name);
    if (!current || current.activated || !current.loaded) {
      return;
    }
    current.activated = true;
    asOneChange(() => {
      if (current.enabled) {
        // A plugin that owns something says so, and keeps it across a
        // deactivate/activate cycle for the same reason it does across
        // disable/enable: rebuilding hands back a new instance while whatever
        // captured the old one carries on holding a detached object.
        const keepsWhatItBuilt =
          current.plugin.preserveOutput && current.outputValue !== undefined;
        if (!keepsWhatItBuilt) {
          runInitAndBuild(name);
        }
        runRegister(name);
      }
    });
  }

  /** Fetch a lazy plugin's module and fold it into its runtime state. */
  async function loadModule(name: string): Promise<void> {
    const current = state.get(name);
    if (!current?.lazy || current.loaded) {
      return;
    }
    // Started before the await so overlapping passes share one fetch — React
    // StrictMode's start/stop/start produces exactly that.
    current.loading ??= Promise.resolve().then(() => current.lazy!.load());
    try {
      const module = await current.loading;
      if (current.loaded) {
        // Another pass got here first. Folding it in again would register
        // everything this plugin contributes a second time.
        return;
      }
      const loaded =
        (module as { default?: ReactorPlugin<any, any, any> }).default ??
        (module as ReactorPlugin<any, any, any>);
      if (!loaded || typeof loaded !== 'object' || !loaded.name) {
        throw new Error(`Lazy plugin ${name} did not resolve to a plugin`);
      }
      current.plugin = mergeLoaded(current.lazy, loaded);
      current.config = mergeWithDefaults(
        current.plugin,
        (configOverrides.get(name) ?? {}) as never,
      );
      current.loaded = true;
    } catch (error) {
      // One plugin that cannot be fetched is one plugin missing, not a dead
      // platform: the failure is recorded and everything else carries on.
      current.loadError = error instanceof Error ? error : new Error(String(error));
      emitChange();
    }
  }

  /**
   * Activate one plugin, and whatever it depends on, first.
   *
   * A plugin woken by an event may depend on one still waiting for an event of
   * its own; building against a dependency that has not run would be the same
   * bug as activating out of dependency order at startup. So dependencies are
   * activated on demand here, regardless of what they were waiting for.
   */
  function ensureActivated(name: string): Promise<void> {
    const current = state.get(name);
    if (!current || current.activated) {
      return Promise.resolve();
    }
    const inFlight = activating.get(name);
    if (inFlight) {
      return inFlight;
    }
    const run = (async () => {
      for (const dep of current.plugin.dependencies ?? []) {
        await ensureActivated(asConfigured(dep).plugin.name);
      }
      if (current.lazy && !current.loaded) {
        await loadModule(name);
      }
      activateLoaded(name);
      // However it came up — an event, a read, a dependency, a backend plugin
      // returning — it is up. Holding a claim on reviving it later would mean
      // reviving something that never went away.
      standingDownForBackend.delete(name);
    })().finally(() => {
      activating.delete(name);
    });
    activating.set(name, run);
    return run;
  }

  /**
   * Activate everything waiting on an event.
   *
   * Modules are fetched in parallel and phases run in dependency order: one
   * slow download must not hold up the others, but a dependant must never
   * register before what it depends on. Each activation is its own change, so
   * a UI fills in plugin by plugin rather than in one late jump.
   */
  async function activateFor(event: ActivationEvent): Promise<string[]> {
    const waiting = waitingFor(event);
    if (waiting.length === 0) {
      return [];
    }
    // Kick every fetch off before awaiting any of them.
    for (const name of waiting) {
      const current = state.get(name);
      if (current?.lazy && !current.loaded) {
        current.loading ??= Promise.resolve().then(() => current.lazy!.load());
      }
    }
    // `waiting` is in topological order, so awaiting in sequence activates
    // dependencies before dependants without any further bookkeeping.
    for (const name of waiting) {
      await ensureActivated(name);
    }
    // Reported from the state rather than from `waiting`: one that failed to
    // load is not one that activated.
    return waiting.filter((name) => state.get(name)?.activated);
  }

  /** Plugins that depend on this one, transitively, in reverse order. */
  function dependantsOf(name: string): string[] {
    const wanted = new Set([name]);
    // `orderedPlugins` is topological, so one forward pass closes over the
    // whole transitive set: a dependant is always visited after what it needs.
    for (const plugin of orderedPlugins) {
      const dependsOnWanted = (plugin.dependencies ?? []).some((dep) =>
        wanted.has(asConfigured(dep).plugin.name),
      );
      if (dependsOnWanted) {
        wanted.add(plugin.name);
      }
    }
    wanted.delete(name);
    // Reversed: the furthest dependant stands down first, so nothing is ever
    // torn down while something still holding its output is running.
    return orderedPlugins
      .map((plugin) => plugin.name)
      .filter((candidate) => wanted.has(candidate))
      .reverse();
  }

  /** Whether everything this plugin depends on is switched on. */
  function dependenciesEnabled(name: string): boolean {
    const plugin = state.get(name)?.plugin;
    return (plugin?.dependencies ?? []).every(
      (dep) => state.get(asConfigured(dep).plugin.name)?.enabled ?? true,
    );
  }

  /**
   * Switch one plugin on, without touching anything around it.
   *
   * The cascade lives in `enable`; this is the part that runs the phases, and
   * it is shared so that a plugin brought back as a dependant comes back the
   * same way as one somebody switched on by hand.
   */
  function enableOne(name: string): void {
    const current = state.get(name);
    if (!current || current.enabled) {
      return;
    }
    current.enabled = true;
    current.disabledBy = undefined;
    if (!current.loaded || !current.activated) {
      // Its activation event has not happened, or its module has not landed.
      // Whichever it is, enabling says only that it may run when it does.
      return;
    }
    // A plugin that owns something says so, and keeps it: rebuilding would
    // hand back a new instance while everything that captured the old one
    // carries on holding a detached object.
    const keepsWhatItBuilt =
      current.plugin.preserveOutput && current.outputValue !== undefined;
    if (!keepsWhatItBuilt) {
      runInitAndBuild(name);
    }
    runRegister(name);
  }

  /**
   * Stand one plugin down, dependants first.
   *
   * @returns every plugin this actually deactivated, in the order it happened
   */
  function deactivatePlugin(name: string, cause: 'backend' | 'other' = 'other'): string[] {
    const current = state.get(name);
    if (!current) {
      throw new Error(`Unknown plugin ${name}`);
    }
    if (cause === 'other') {
      // Before the early return, deliberately. Deactivating a plugin that is
      // *already* down changes nothing about its state, but it does say
      // something: this plugin is the caller's now. Dropping the claim only
      // when there was work to do would leave a server able to revive
      // something somebody had just stood down by hand.
      standingDownForBackend.delete(name);
    }
    if (!current.activated) {
      return [];
    }
    const stoodDown: string[] = [];
    asOneChange(() => {
      for (const dependant of dependantsOf(name)) {
        const dependantState = state.get(dependant);
        if (!dependantState?.activated) {
          continue;
        }
        stopPlugin(dependant);
        dependantState.activated = false;
        forgetPointsAwaiting(dependant);
        stoodDown.push(dependant);
      }
      stopPlugin(name);
      current.activated = false;
      forgetPointsAwaiting(name);
      stoodDown.push(name);
    });
    if (cause === 'other') {
      // Somebody else took these down — an event, or a direct call. They are no
      // longer *this* platform's to bring back when a backend plugin returns,
      // and leaving them on the list would do exactly that: a server coming
      // back would silently undo a deactivation it had nothing to do with.
      for (const stoodDownName of stoodDown) {
        standingDownForBackend.delete(stoodDownName);
      }
    }
    return stoodDown;
  }

  /**
   * Let the points this plugin waits on fire again.
   *
   * A point fires its activation event once, so that a module which failed to
   * load is not re-fetched on every render. That guard would also mean a plugin
   * stood down could never be woken by a read again — so the points *it* waits
   * on are forgotten when it goes, and nobody else's are.
   */
  function forgetPointsAwaiting(name: string): void {
    const events = state.get(name)?.plugin.activationEvents ?? [];
    for (const event of events) {
      if (event.startsWith('onContributionPoint:')) {
        firedPoints.delete(event.slice('onContributionPoint:'.length));
      }
    }
  }

  /** Everything waiting to stand down on this event, dependants included. */
  function deactivateFor(event: ActivationEvent): string[] {
    const stoodDown: string[] = [];
    for (const plugin of orderedPlugins) {
      const current = state.get(plugin.name);
      if (!current?.activated) {
        continue;
      }
      if (matchesDeactivation(current.plugin.deactivationEvents, event)) {
        stoodDown.push(...deactivatePlugin(plugin.name));
      }
    }
    return stoodDown;
  }

  function stopPlugin(name: string) {
    const current = state.get(name);
    if (!current) {
      return;
    }
    current.afterDispose?.();
    current.afterDispose = undefined;
    current.registerDispose?.();
    current.registerDispose = undefined;
    // Whatever it contributed goes with it: a disabled plugin must not keep
    // a view in the switcher or a command in the palette.
    contributions.disposePlugin(name);
    commands.disposePlugin(name);
  }

  return {
    ...reactorView,
    start() {
      started = true;
      asOneChange(() => {
        // Eager plugins due at startup, in dependency order, synchronously —
        // that is what lets the first paint happen without awaiting anything.
        const due = orderedPlugins.filter((plugin) => {
          const current = state.get(plugin.name);
          return (
            current &&
            current.loaded &&
            !current.activated &&
            activatesAtStartup(current.plugin.activationEvents)
          );
        });
        for (const plugin of due) {
          state.get(plugin.name)!.activated = true;
          runInitAndBuild(plugin.name);
        }
        for (const plugin of due) {
          runRegister(plugin.name);
        }
      });
      // After the eager pass, never before it: a fetch between `start()` and
      // the first paint is exactly what this split exists to avoid.
      readyPromise = activateFor(ON_STARTUP).then(() => undefined);
    },
    whenReady() {
      return readyPromise ?? Promise.resolve();
    },
    async fire(event: ActivationEvent): Promise<FiredEvent> {
      // Down before up: one event retiring the old thing and bringing up the
      // new is a single call, and doing it the other way round would leave
      // both running for a beat.
      const deactivated = deactivateFor(event);
      const activated = await activateFor(event);
      return { deactivated, activated };
    },
    deactivate(name: string) {
      deactivatePlugin(name);
    },
    async setBackendPlugins(available: readonly string[]): Promise<FiredEvent> {
      availableBackendPlugins = new Set(available);
      const satisfied = (name: string) =>
        (state.get(name)?.plugin.requiredBackendPlugins ?? []).every((backend) =>
          availableBackendPlugins.has(backend),
        );

      // Down first, for the same reason `fire` does it: one change of the
      // server's mind should retire what can no longer work before bringing up
      // what now can.
      const deactivated: string[] = [];
      for (const plugin of orderedPlugins) {
        const current = state.get(plugin.name);
        if (!current?.activated || satisfied(plugin.name)) {
          continue;
        }
        const stoodDown = deactivatePlugin(plugin.name, 'backend');
        for (const name of stoodDown) {
          standingDownForBackend.add(name);
        }
        deactivated.push(...stoodDown);
      }

      const activated: string[] = [];
      // Topological order, so a dependency is back before its dependant.
      for (const plugin of orderedPlugins) {
        const name = plugin.name;
        if (!standingDownForBackend.has(name) || !satisfied(name)) {
          continue;
        }
        const current = state.get(name);
        // Never revive what a person switched off. This is the invariant the
        // whole cross-tier story rests on: an event may say the reason for
        // running returned, and a checkbox still outranks it.
        if (!current?.enabled) {
          continue;
        }
        standingDownForBackend.delete(name);
        await ensureActivated(name);
        if (state.get(name)?.activated) {
          activated.push(name);
        }
      }

      return { deactivated, activated };
    },
    async install(input: PlatformInput): Promise<string[]> {
      const incoming = normalizePlugins([input]);
      const fresh = incoming.plugins.filter((plugin) => !state.has(plugin.name));
      if (fresh.length === 0) {
        return [];
      }

      // Conflicts are checked against everything, not just the new arrivals:
      // the whole point of a conflict is that two plugins cannot coexist, and
      // one of them being here already is the usual way that happens.
      for (const plugin of fresh) {
        for (const conflict of plugin.conflictsWith ?? []) {
          if (byName.has(conflict) || fresh.some((one) => one.name === conflict)) {
            throw new Error(`Plugin ${plugin.name} conflicts with ${conflict}`);
          }
        }
      }

      for (const [name, ref] of incoming.lazyByName) {
        lazyByName.set(name, ref);
      }
      for (const [name, from] of incoming.extensionOf) {
        extensionOf.set(name, from);
      }
      for (const [name, extension] of incoming.extensions) {
        extensions.set(name, extension);
      }

      const overrides = collectOverrides([input]);
      for (const plugin of fresh) {
        byName.set(plugin.name, plugin);
        state.set(plugin.name, {
          plugin,
          config: mergeWithDefaults(plugin, (overrides.get(plugin.name) ?? {}) as never),
          enabled: true,
          activated: false,
          extension: extensionOf.get(plugin.name),
          lazy: lazyByName.get(plugin.name),
          loaded: !lazyByName.has(plugin.name),
        });
      }

      // Re-sorted in place rather than appended: `orderedPlugins` is what every
      // dependency walk reads, and a plugin installed now may sit *between* two
      // that were here before.
      const reordered = topoSort([...orderedPlugins, ...fresh]);
      orderedPlugins.splice(0, orderedPlugins.length, ...reordered);

      // Listed immediately, whether or not it activates: a host should be able
      // to draw and describe what it just installed while the module is still
      // on the wire.
      emitChange();

      if (!started) {
        // It will go up with everything else. Installing before `start` is the
        // same as having passed it to the builder.
        return fresh.map((plugin) => plugin.name);
      }

      const installed: string[] = [];
      for (const plugin of reordered) {
        if (!fresh.some((one) => one.name === plugin.name)) {
          continue;
        }
        installed.push(plugin.name);
        if (activatesAtStartup(plugin.activationEvents)) {
          await ensureActivated(plugin.name);
        }
      }
      return installed;
    },
    stop() {
      started = false;
      asOneChange(() => {
        for (const plugin of [...orderedPlugins].reverse()) {
          stopPlugin(plugin.name);
          const current = state.get(plugin.name);
          if (current) {
            // Stopping undoes activation: a restarted platform runs the phases
            // again, which is what `start` after `stop` has always meant.
            current.activated = false;
          }
        }
        firedPoints.clear();
      });
    },
    enable(name: string) {
      const current = state.get(name);
      if (!current) {
        throw new Error(`Unknown plugin ${name}`);
      }
      if (current.enabled) {
        return;
      }
      asOneChange(() => {
        enableOne(name);
        // Bring back what *this* plugin's disabling took down, and nothing
        // else. `dependantsOf` is deepest-first for tearing down, so it is
        // reversed here: a dependency has to be running again before the thing
        // that needs it starts.
        for (const dependant of [...dependantsOf(name)].reverse()) {
          const dependantState = state.get(dependant);
          if (!dependantState || dependantState.enabled) {
            continue;
          }
          // Somebody switched this one off by hand. Their decision outlives a
          // dependency coming back — otherwise a switch could be undone by an
          // unrelated one three plugins away.
          if (dependantState.disabledBy !== 'dependency') {
            continue;
          }
          // Still missing something else it needs.
          if (!dependenciesEnabled(dependant)) {
            continue;
          }
          enableOne(dependant);
        }
      });
    },
    disable(name: string) {
      const current = state.get(name);
      if (!current) {
        throw new Error(`Unknown plugin ${name}`);
      }
      if (!current.enabled) {
        return;
      }
      asOneChange(() => {
        // Dependants first, transitively. A dependant left running against a
        // disabled dependency is holding an output nobody maintains — and it
        // will read `getOutput` and find nothing, which is a crash somewhere
        // that has no idea why.
        for (const dependant of dependantsOf(name)) {
          const dependantState = state.get(dependant);
          if (!dependantState?.enabled) {
            continue;
          }
          dependantState.enabled = false;
          dependantState.disabledBy = 'dependency';
          stopPlugin(dependant);
        }
        current.enabled = false;
        current.disabledBy = 'user';
        stopPlugin(name);
      });
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    listPlugins() {
      return orderedPlugins.map((plugin) => plugin.name);
    },
    listExtensions() {
      return [...extensions.keys()];
    },
    getExtensionManifest(name: string): ExtensionManifest | undefined {
      const extension = extensions.get(name);
      if (!extension) {
        return undefined;
      }
      return {
        name: extension.name,
        version: extension.version,
        displayName: extension.displayName ?? extension.name,
        description: extension.description,
        octicon: extension.octicon,
        emoji: extension.emoji,
        // Read back from what was actually registered, not from the
        // declaration: a plugin that appeared twice is listed once.
        plugins: orderedPlugins
          .filter((plugin) => extensionOf.get(plugin.name) === name)
          .map((plugin) => plugin.name),
      };
    },
    getConfig<C = unknown>(name: string): C | undefined {
      return state.get(name)?.config as C | undefined;
    },
    describeContributions() {
      return contributions.describe();
    },
    listCommands() {
      return commands.list();
    },
    getCommand(id: string) {
      return commands.get(id);
    },
    executeCommand<A = void, R = unknown>(id: string, argument?: A) {
      return commands.execute<A, R>(id, argument);
    },
    getDependencies(name: string): string[] {
      return (state.get(name)?.plugin.dependencies ?? []).map(
        (dep) => asConfigured(dep).plugin.name,
      );
    },
    getRevision() {
      return revision;
    },
  };
}
