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

export type ReactorExtension<C, I, O> = {
  name: string;
  version?: string;
  requiredBackendPlugins?: string[];
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
   * Contributions declared up-front, resolved by the reactor during the
   * register phase — the declarative twin of `ctx.contribute`. Use this when a
   * contribution does not depend on build output; use `ctx.contribute` when it
   * does, or when it appears later.
   */
  contributes?: ContributionRecord<any>[];
  register?: (ctx: PhaseContext<C, I, O>) => void | Dispose;
  afterRegistration?: (ctx: PhaseContext<C, I, O>) => void | Dispose;
};

export type ReactorPlatformView = {
  hasExtension: (name: string) => boolean;
  getOutput: <T = unknown>(name: string) => T | undefined;
  getRequiredBackendPlugins: (name: string) => string[];
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
