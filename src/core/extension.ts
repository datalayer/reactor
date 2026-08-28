/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import { shallowMergeConfig } from './reactor';
import type {
  ContributeOptions,
  Contribution,
  ContributionRecord,
  ExtensionPoint,
} from './contributions';

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
export interface ExtensionPresentation {
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
 * Everything a host can know about an extension without running it.
 *
 * Available before a lazy extension's module has loaded, which is the point:
 * a plugin can be listed, described and drawn while it is still on the wire.
 */
export type ExtensionMetadata = ExtensionPresentation & {
  name: string;
  version?: string;
  /** Backend plugins this extension cannot work without. */
  requiredBackendPlugins: string[];
  /** Backend plugins it uses when they are there, and does without when not. */
  optionalBackendPlugins: string[];
  /** Whether the extension's module is loaded (always true when not lazy). */
  loaded: boolean;
  /** Whether it is lazy, however far along its load is. */
  lazy: boolean;
  /** Ids of the extension points this extension offers to others. */
  extensionPoints: string[];
};

export type PeerDependency = {
  name: string;
  optional?: boolean;
};

export type ExtensionRef = ReactorExtension<any, any, any> | ConfiguredExtension<any, any, any>;

export type ConfiguredExtension<C, I, O> = {
  extension: ReactorExtension<C, I, O>;
  config: Partial<C>;
};

export type PhaseContext<C, I, O> = {
  extension: ReactorExtension<C, I, O>;
  config: C;
  state: ExtensionState<C, I, O>;
  reactor: ReactorPlatformView;
  /**
   * Contribute to an extension point. Usable in any phase and at any time
   * afterwards — a contribution made after `start()` is picked up by hosts
   * immediately. The returned disposer is idempotent, and everything an
   * extension contributed is disposed automatically when it stops or is
   * disabled.
   */
  contribute: <T>(
    point: ExtensionPoint<T>,
    value: T,
    options?: ContributeOptions,
  ) => Dispose;
};

export type ExtensionState<C, I, O> = {
  getConfig: () => C;
  getInit: () => I | undefined;
  getOutput: () => O | undefined;
};

export interface ReactorExtension<C, I, O> extends ExtensionPresentation {
  name: string;
  version?: string;
  /**
   * Backend (Python) plugins this extension cannot work without.
   *
   * Slots belonging to the extension stop rendering while one is missing or
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
   * never stops the extension rendering: reacting to it is the extension's own
   * job, through `reactor.isBackendPluginAvailable`.
   */
  optionalBackendPlugins?: string[];
  config?: C;
  dependencies?: ExtensionRef[];
  peerDependencies?: PeerDependency[];
  conflictsWith?: string[];
  mergeConfig?: (base: C, override: Partial<C>) => C;
  init?: (ctx: PhaseContext<C, I, O>) => I;
  build?: (ctx: PhaseContext<C, I, O>) => O;
  /**
   * Keep this extension's build output across a disable/enable cycle.
   *
   * `enable()` normally re-runs `init` and `build`, which is right for an
   * extension that only contributes records: it comes back clean. It is wrong
   * for one that *owns something* — a connection, a kernel, a cache — because
   * the fresh build returns a new instance and everything holding the previous
   * one is quietly detached.
   *
   * With this set, enabling an extension that has already built keeps what it
   * built and only re-runs `register`. Turning a sandbox plugin off and on then
   * leaves the sandbox where it was.
   */
  preserveOutput?: boolean;
  /**
   * The extension points this extension *offers* to others.
   *
   * The registry knows who contributed to a point; it cannot know who opened
   * it, because a point is only an id until something is put there. Declaring
   * it here is what lets a host draw the other half of the relationship — and
   * show a point that nobody has contributed to yet, which is exactly when
   * knowing it exists is most useful.
   */
  extensionPoints?: ExtensionPoint<any>[];
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

export type ReactorPlatformView = {
  hasExtension: (name: string) => boolean;
  getOutput: <T = unknown>(name: string) => T | undefined;
  getRequiredBackendPlugins: (name: string) => string[];
  /** Backend plugins the extension uses when present. Never gates rendering. */
  getOptionalBackendPlugins: (name: string) => string[];
  /** Everything knowable about an extension without running it. */
  getMetadata: (name: string) => ExtensionMetadata | undefined;
  isEnabled: (name: string) => boolean;
  /**
   * Everything contributed to a point by enabled extensions, ordered by
   * `order` and then by contribution order.
   */
  getContributions: <T>(point: ExtensionPoint<T>) => Contribution<T>[];
};

export function defineExtension<C = Record<string, never>, I = unknown, O = unknown>(
  extension: ReactorExtension<C, I, O>,
): ReactorExtension<C, I, O> {
  return extension;
}

/** What a lazy extension's loader resolves to — a module or the value itself. */
export type LazyExtensionLoader = () => Promise<
  ReactorExtension<any, any, any> | { default: ReactorExtension<any, any, any> }
>;

/**
 * An extension whose module is fetched after the platform has started.
 *
 * Everything a host needs *before* the code arrives is declared here rather
 * than inside the module: the name it is known by, what it depends on, what it
 * needs from the backend, and how to present it. That is what lets the shell
 * paint a complete plugin list — and hold a place for this one — while the
 * module is still on the wire.
 */
export interface LazyExtensionRef extends ExtensionPresentation {
  name: string;
  version?: string;
  /** Fetches the module. Called once; a second `start` reuses the result. */
  load: LazyExtensionLoader;
  /**
   * Declared up-front because ordering cannot wait for the module: the reactor
   * has to know what must be activated before this, before it can activate it.
   */
  dependencies?: ExtensionRef[];
  requiredBackendPlugins?: string[];
  optionalBackendPlugins?: string[];
  /** Points the module offers, declared up-front so the graph is complete. */
  extensionPoints?: ExtensionPoint<any>[];
}

/**
 * Declare an extension that loads after the first paint.
 *
 * ```ts
 * export const HeavyExtension = defineLazyExtension({
 *   name: '@app/heavy',
 *   displayName: 'Heavy',
 *   dependencies: [BaseExtension],
 *   load: () => import('./heavy'),
 * });
 * ```
 */
export function defineLazyExtension(ref: LazyExtensionRef): LazyExtensionRef {
  if (!ref.name) {
    throw new Error('defineLazyExtension: a lazy extension needs a name');
  }
  if (typeof ref.load !== 'function') {
    throw new Error(`defineLazyExtension: ${ref.name} needs a load function`);
  }
  return ref;
}

/** Whether a reference is a lazy one, i.e. still has a module to fetch. */
export function isLazyExtensionRef(ref: unknown): ref is LazyExtensionRef {
  return (
    typeof ref === 'object' &&
    ref !== null &&
    typeof (ref as LazyExtensionRef).load === 'function' &&
    typeof (ref as LazyExtensionRef).name === 'string' &&
    !('extension' in ref)
  );
}

export function configExtension<C, I, O>(
  extension: ReactorExtension<C, I, O>,
  config: Partial<C>,
): ConfiguredExtension<C, I, O> {
  return { extension, config };
}

export function declarePeerDependency(name: string, optional = true): PeerDependency {
  return { name, optional };
}

export function asConfigured<C, I, O>(
  ref: ExtensionRef,
): ConfiguredExtension<C, I, O> {
  if ('extension' in ref) {
    return ref as ConfiguredExtension<C, I, O>;
  }
  return { extension: ref as ReactorExtension<C, I, O>, config: {} };
}

export function mergeWithDefaults<C>(
  extension: ReactorExtension<C, unknown, unknown>,
  override: Partial<C>,
): C {
  const defaults = (extension.config ?? ({} as C)) as C;
  if (extension.mergeConfig) {
    return extension.mergeConfig(defaults, override);
  }
  return shallowMergeConfig(defaults, override);
}
