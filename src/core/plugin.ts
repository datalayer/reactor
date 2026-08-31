/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The plugin: the fundamental modular, installable unit.
 *
 * A plugin declares contributions and may provide executable code. Everything
 * else in the reactor is defined in terms of it — an {@link ReactorExtension}
 * groups plugins, a contribution point is a place plugins fill, an activation
 * event is a condition on a plugin becoming active.
 *
 * The split that matters here is between what a plugin *says* and what it
 * *does*. What it says is its manifest: name, presentation, dependencies, the
 * points it offers, the contributions it declares, when it wants to activate.
 * That is readable without running anything, which is what lets a host list,
 * describe, draw and disable a plugin whose code has never been fetched. What
 * it does is its phases — `init`, `build`, `register`, `afterRegistration` —
 * and those only ever run once the plugin is activated.
 *
 * @module core/plugin
 */

import { shallowMergeConfig } from './reactor';
import type { ActivationEvent } from './activation';
import type {
  ContributeOptions,
  Contribution,
  ContributionPoint,
  ContributionRecord,
} from './contributions';
import type { Gate, GateVerdict } from './gates';

export type Dispose = () => void;

/**
 * How a plugin presents itself to a person.
 *
 * Separate from `name`, which is an identifier: `@music/catalog` is what other
 * plugins depend on, "Catalog" is what a reader is shown. Every field is
 * optional — a plugin that says nothing still runs, and a host that shows
 * nothing still works — so this can be adopted one plugin at a time.
 *
 * The same four fields exist on the Python `PluginManifest`, deliberately: a
 * host listing both tiers should not have to special-case which side a plugin
 * came from.
 */
export interface PluginPresentation {
  /** Human-readable name. Hosts fall back to `name` when it is absent. */
  displayName?: string;
  /** One or two sentences: what this plugin is for. */
  description?: string;
  /** Octicon id, e.g. `package`, `plug`, `beaker`. */
  octicon?: string;
  /** A single emoji, for hosts with no icon set to draw from. */
  emoji?: string;
}

/**
 * Everything a host can know about a plugin without running it.
 *
 * This is the plugin manifest: metadata, the contributions and contribution
 * points it declares, its activation rules, and whether its entry point has
 * been fetched yet. Available *before* a lazy plugin's module has loaded,
 * which is the whole point — a plugin can be listed, described, drawn and
 * switched off while it is still on the wire.
 *
 * Named to match the Python `PluginManifest` field for field, so a host that
 * lists both tiers reads one shape.
 */
export type PluginManifest = PluginPresentation & {
  name: string;
  version?: string;
  /** The extension that groups this plugin, when it came from one. */
  extension?: string;
  /** Backend plugins this plugin cannot work without. */
  requiredBackendPlugins: string[];
  /** Backend plugins it uses when they are there, and does without when not. */
  optionalBackendPlugins: string[];
  /** Whether the plugin's module is loaded (always true when not lazy). */
  loaded: boolean;
  /** Whether it is lazy, however far along its load is. */
  lazy: boolean;
  /**
   * Whether its activation condition has been met.
   *
   * Not the same as running: phases run when a plugin is both activated and
   * enabled. A plugin can be activated and switched off, or enabled and still
   * waiting for the event it declared.
   */
  activated: boolean;
  /**
   * Why it is switched off, when it is — and `undefined` when it is not.
   *
   * `'user'` is somebody's decision and it sticks. `'dependency'` means it was
   * taken down with something it needs, and it returns when that does. A host
   * drawing a switch should say which: a row that a person turned off and a row
   * that went with its dependency are not the same fact, and offering the same
   * control for both invites turning one back on to no effect.
   */
  disabledBy?: 'user' | 'dependency';
  /** What has to happen for it to activate. Empty means "at startup". */
  activationEvents: ActivationEvent[];
  /** What makes it stand down again. Empty means nothing does. */
  deactivationEvents: ActivationEvent[];
  /** Ids of the contribution points this plugin offers to others. */
  contributionPoints: string[];
  /** Ids of the points it declares contributions to, up-front. */
  contributesTo: string[];
};

export type PeerDependency = {
  name: string;
  optional?: boolean;
};

export type PluginRef = ReactorPlugin<any, any, any> | ConfiguredPlugin<any, any, any>;

export type ConfiguredPlugin<C, I, O> = {
  plugin: ReactorPlugin<C, I, O>;
  config: Partial<C>;
};

/**
 * The Reactor API: what a plugin is handed to interact with the platform.
 *
 * Every phase receives one. It is the only channel a plugin needs — it can
 * contribute through it, read what others contributed, ask a gate, and learn
 * what else is installed — and deliberately the only one, so that what a
 * plugin can do to the platform is a list somebody can read.
 */
export type PhaseContext<C, I, O> = {
  plugin: ReactorPlugin<C, I, O>;
  config: C;
  state: PluginState<C, I, O>;
  reactor: ReactorPlatformView;
  /**
   * Contribute to a contribution point. Usable in any phase and at any time
   * afterwards — a contribution made after `start()` is picked up by hosts
   * immediately. The returned disposer is idempotent, and everything a plugin
   * contributed is disposed automatically when it stops or is disabled.
   */
  contribute: <T>(
    point: ContributionPoint<T>,
    value: T,
    options?: ContributeOptions,
  ) => Dispose;
};

export type PluginState<C, I, O> = {
  getConfig: () => C;
  getInit: () => I | undefined;
  getOutput: () => O | undefined;
};

export interface ReactorPlugin<C, I, O> extends PluginPresentation {
  name: string;
  version?: string;
  /**
   * When this plugin should activate.
   *
   * Omitted means "at startup", which is what a plugin without an opinion
   * wants. Declare events — `onStartup`, `onContributionPoint:app.toolbar`,
   * `onView:notebook`, or anything the application fires — to hold the plugin
   * back until one of them happens. Only meaningful for a lazy plugin: an
   * eagerly imported one has already cost what it costs.
   *
   * See `core/activation`.
   */
  activationEvents?: ActivationEvent[];
  /**
   * When this plugin should stand down again.
   *
   * Omitted means never, which is the right default: a plugin with no opinion
   * about deactivation should keep running. Declaring events retires it when
   * one fires — its contributions go, its disposers run, its module stays, and
   * it comes back if an activation event fires later.
   *
   * Deactivating is not disabling. Disabling is a person's decision and it
   * sticks; this is the platform saying the reason for running has passed.
   */
  deactivationEvents?: ActivationEvent[];
  /**
   * Backend (Python) plugins this plugin cannot work without.
   *
   * Slots belonging to the plugin stop rendering while one is missing or
   * switched off — the host decides what "available" means and answers through
   * `isBackendPluginAvailable`.
   */
  requiredBackendPlugins?: string[];
  /**
   * Backend plugins it will use if they are running, and do without if not.
   *
   * Declared rather than merely queried so a host can show the relationship
   * before anything is loaded, and so an absent optional plugin is a
   * documented state rather than a silent one. Unlike a required plugin, this
   * never stops the plugin rendering: reacting to it is the plugin's own job,
   * through `reactor.isBackendPluginAvailable`.
   */
  optionalBackendPlugins?: string[];
  config?: C;
  dependencies?: PluginRef[];
  peerDependencies?: PeerDependency[];
  conflictsWith?: string[];
  mergeConfig?: (base: C, override: Partial<C>) => C;
  init?: (ctx: PhaseContext<C, I, O>) => I;
  build?: (ctx: PhaseContext<C, I, O>) => O;
  /**
   * Keep this plugin's build output across a disable/enable cycle.
   *
   * `enable()` normally re-runs `init` and `build`, which is right for a
   * plugin that only contributes records: it comes back clean. It is wrong
   * for one that *owns something* — a connection, a kernel, a cache — because
   * the fresh build returns a new instance and everything holding the previous
   * one is quietly detached.
   *
   * With this set, enabling a plugin that has already built keeps what it
   * built and only re-runs `register`. Turning a sandbox plugin off and on then
   * leaves the sandbox where it was.
   */
  preserveOutput?: boolean;
  /**
   * The contribution points this plugin *offers* to others.
   *
   * The registry knows who contributed to a point; it cannot know who opened
   * it, because a point is only an id until something is put there. Declaring
   * it here is what lets a host draw the other half of the relationship — and
   * show a point that nobody has contributed to yet, which is exactly when
   * knowing it exists is most useful.
   */
  contributionPoints?: ContributionPoint<any>[];
  /**
   * Contributions declared up-front, resolved by the reactor during the
   * register phase — the declarative twin of `ctx.contribute`. Use this when a
   * contribution does not depend on build output; use `ctx.contribute` when it
   * does, or when it appears later.
   */
  contributes?: ContributionRecord<any>[];
  register?: (ctx: PhaseContext<C, I, O>) => void | Dispose;
  afterRegistration?: (ctx: PhaseContext<C, I, O>) => void | Dispose;
}

/**
 * The Reactor API as a plugin sees it.
 *
 * The read side of the platform, plus the two things a plugin does to it:
 * contribute (through {@link PhaseContext.contribute}) and ask.
 */
export type ReactorPlatformView = {
  hasPlugin: (name: string) => boolean;
  getOutput: <T = unknown>(name: string) => T | undefined;
  getRequiredBackendPlugins: (name: string) => string[];
  /** Backend plugins the plugin uses when present. Never gates rendering. */
  getOptionalBackendPlugins: (name: string) => string[];
  /** Everything knowable about a plugin without running it. */
  getManifest: (name: string) => PluginManifest | undefined;
  isEnabled: (name: string) => boolean;
  /**
   * Everything contributed to a point by enabled plugins, ordered by `order`
   * and then by contribution order.
   *
   * Reading a point fires its activation event, so a plugin waiting on
   * `onContributionPoint:<id>` loads because somebody looked. The read itself
   * is synchronous and returns what is there now; the late arrivals show up on
   * the next revision, which is what every host is already subscribed to.
   */
  getContributions: <T>(point: ContributionPoint<T>) => Contribution<T>[];
  /**
   * Ask a gate: may this happen, and if not, what does the person get told?
   *
   * Allowed when nothing answers — a gate no plugin cares about must never be
   * a wall. See `core/gates`.
   */
  checkGate: <C>(gate: Gate<C>, context: C) => GateVerdict;
};

/**
 * Declare a plugin.
 *
 * ```ts
 * export const NotebookPlugin = definePlugin({
 *   name: '@app/notebook',
 *   displayName: 'Notebook',
 *   contributionPoints: [NotebookToolbar],
 *   contributes: [contribution(ViewType, { title: 'Notebook' })],
 * });
 * ```
 */
export function definePlugin<C = Record<string, never>, I = unknown, O = unknown>(
  plugin: ReactorPlugin<C, I, O>,
): ReactorPlugin<C, I, O> {
  return plugin;
}

/** What a lazy plugin's loader resolves to — a module or the value itself. */
export type LazyPluginLoader = () => Promise<
  ReactorPlugin<any, any, any> | { default: ReactorPlugin<any, any, any> }
>;

/**
 * A plugin whose module is fetched after the platform has started.
 *
 * Everything a host needs *before* the code arrives is declared here rather
 * than inside the module: the name it is known by, what it depends on, what it
 * needs from the backend, when it wants to activate, and how to present it.
 * That is what lets the shell paint a complete plugin list — and hold a place
 * for this one — while the module is still on the wire.
 *
 * This is the manifest/entry-point split made concrete: this object *is* the
 * manifest, and `load` is the entry point.
 */
export interface LazyPluginRef extends PluginPresentation {
  name: string;
  version?: string;
  /** Fetches the module. Called once; a second `start` reuses the result. */
  load: LazyPluginLoader;
  /**
   * What has to happen before the module is fetched at all.
   *
   * Omitted means "at startup" — fetched right after the eager pass, as a lazy
   * plugin always was. Declared, it holds the download until one of the events
   * fires, which is the difference between a plugin that costs a request on
   * every page load and one that costs nothing until it is wanted.
   */
  activationEvents?: ActivationEvent[];
  /** What makes it stand down again. Omitted means nothing does. */
  deactivationEvents?: ActivationEvent[];
  /**
   * Declared up-front because ordering cannot wait for the module: the reactor
   * has to know what must be activated before this, before it can activate it.
   */
  dependencies?: PluginRef[];
  requiredBackendPlugins?: string[];
  optionalBackendPlugins?: string[];
  /** Points the module offers, declared up-front so the graph is complete. */
  contributionPoints?: ContributionPoint<any>[];
}

/**
 * Declare a plugin that loads after the first paint.
 *
 * ```ts
 * export const HeavyPlugin = defineLazyPlugin({
 *   name: '@app/heavy',
 *   displayName: 'Heavy',
 *   dependencies: [BasePlugin],
 *   activationEvents: [onView('heavy')],
 *   load: () => import('./heavy'),
 * });
 * ```
 */
export function defineLazyPlugin(ref: LazyPluginRef): LazyPluginRef {
  if (!ref.name) {
    throw new Error('defineLazyPlugin: a lazy plugin needs a name');
  }
  if (typeof ref.load !== 'function') {
    throw new Error(`defineLazyPlugin: ${ref.name} needs a load function`);
  }
  return ref;
}

/** Whether a reference is a lazy one, i.e. still has a module to fetch. */
export function isLazyPluginRef(ref: unknown): ref is LazyPluginRef {
  return (
    typeof ref === 'object' &&
    ref !== null &&
    typeof (ref as LazyPluginRef).load === 'function' &&
    typeof (ref as LazyPluginRef).name === 'string' &&
    !('plugin' in ref)
  );
}

export function configurePlugin<C, I, O>(
  plugin: ReactorPlugin<C, I, O>,
  config: Partial<C>,
): ConfiguredPlugin<C, I, O> {
  return { plugin, config };
}

export function declarePeerDependency(name: string, optional = true): PeerDependency {
  return { name, optional };
}

export function asConfigured<C, I, O>(
  ref: PluginRef,
): ConfiguredPlugin<C, I, O> {
  if ('plugin' in ref) {
    return ref as ConfiguredPlugin<C, I, O>;
  }
  return { plugin: ref as ReactorPlugin<C, I, O>, config: {} };
}

export function mergeWithDefaults<C>(
  plugin: ReactorPlugin<C, unknown, unknown>,
  override: Partial<C>,
): C {
  const defaults = (plugin.config ?? ({} as C)) as C;
  if (plugin.mergeConfig) {
    return plugin.mergeConfig(defaults, override);
  }
  return shallowMergeConfig(defaults, override);
}
