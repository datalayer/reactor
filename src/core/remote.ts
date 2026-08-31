/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Plugins whose module arrives from somewhere the shell was not built with.
 *
 * A lazy plugin already defers its module — `load: () => import('./heavy')`.
 * The only thing a *remote* plugin changes is where that module comes from: a
 * URL, served by a host that installed the plugin after the shell was built.
 * Everything else the runtime does — ordering, activation events, failure
 * isolation, disable/enable, the graph — works unchanged, because a
 * `LazyPluginRef` is what this module produces.
 *
 * That is the design, and it is worth stating plainly: **there is no second
 * kind of plugin.** A remote plugin is a lazy plugin with a different `load`.
 *
 * Two things a URL brings that a bundled import does not:
 *
 * 1. **Shared modules.** A module the bundler never saw cannot `import 'react'`
 *    and get the host's copy. So the host publishes its copies
 *    ({@link setReactorSharedModules}) and a remote borrows them. This is what
 *    Module Federation's `shared` does; until the Rsbuild migration brings it,
 *    this is the same idea with the machinery removed.
 * 2. **A version to refuse.** The Python tier has had `PluginCompatibility`
 *    all along. A module fetched over the wire needs it more, and needs to be
 *    refused *politely* — the plugin stays listed with a reason, rather than
 *    throwing from inside somebody's render.
 *
 * @module core/remote
 */

import { defineExtension, type ReactorExtension } from './extension';
import { defineLazyPlugin, type LazyPluginRef } from './plugin';
import type { ActivationEvent } from './activation';

/** Where the host parks the modules it is willing to share. */
const SHARED_GLOBAL = '__DATALAYER_REACTOR__';

/** The API version this runtime speaks. Bumped when a remote would break. */
export const REACTOR_API_VERSION = 'v1';

/**
 * The modules a host must publish, and a remote must never bundle.
 *
 * The failure this prevents is not subtle and not recoverable at runtime: two
 * Reacts means hooks throw from inside a component that looks perfectly fine,
 * and the error names none of this. So the set is written down once, here, and
 * both halves read it — a host to know what to publish, a build to know what
 * to leave out.
 *
 * It is the floor, not the whole list. A host whose plugins draw with a design
 * system must add it: `[...REACTOR_SHARED_MODULES, '@primer/react']`. The
 * runtime cannot know what that is, which is why this is a constant to extend
 * rather than a policy to enforce.
 */
export const REACTOR_SHARED_MODULES = [
  'react',
  'react-dom',
  '@datalayer/reactor',
  '@datalayer/reactor/react',
] as const;

type SharedRegistry = { shared: Record<string, unknown> };

/**
 * Publish the modules a remote plugin is allowed to borrow.
 *
 * Call it once, before any remote loads — from the shell, with its own
 * imports. The keys are bare specifiers so that a remote asks for what it
 * would have imported:
 *
 * ```ts
 * import * as React from 'react';
 * import * as Reactor from '@datalayer/reactor';
 *
 * setReactorSharedModules({
 *   react: React,
 *   '@datalayer/reactor': Reactor,
 * });
 * ```
 *
 * The set is not enforced and deliberately not fixed here: which modules must
 * be singletons is the *host's* question — its design system belongs in this
 * list as much as React does, and the runtime cannot know what that is.
 */
export function setReactorSharedModules(modules: Record<string, unknown>): void {
  const target = globalThis as unknown as Record<string, SharedRegistry>;
  const existing = target[SHARED_GLOBAL]?.shared ?? {};
  target[SHARED_GLOBAL] = { shared: { ...existing, ...modules } };
}

/** What the host has published, for a remote to read. */
export function getReactorSharedModules(): Record<string, unknown> {
  const target = globalThis as unknown as Record<string, SharedRegistry | undefined>;
  return target[SHARED_GLOBAL]?.shared ?? {};
}

/**
 * Which of the modules a remote will look for have not been published.
 *
 * Called by `defineRemotePlugin` before the first remote loads, so a host that
 * forgot to publish React hears about it as a named warning at load time
 * rather than as a broken-hooks exception during somebody's render.
 *
 * A warning rather than a refusal, deliberately: a host may legitimately share
 * fewer modules than the floor — a remote that uses no React needs none of it —
 * and the runtime is not in a position to know.
 */
export function missingSharedModules(
  expected: readonly string[] = REACTOR_SHARED_MODULES,
): string[] {
  const published = getReactorSharedModules();
  return expected.filter((name) => !(name in published));
}

/** How a remote module is fetched. The seam Module Federation replaces. */
export type RemoteModuleLoader = (url: string) => Promise<Record<string, unknown>>;

/**
 * The default loader: a dynamic import of an absolute URL.
 *
 * The two comments are not decoration. Both bundlers try to resolve a dynamic
 * import at build time, and this one cannot be resolved then — that is the
 * entire point of it.
 */
export const importRemoteModule: RemoteModuleLoader = (url) =>
  import(/* webpackIgnore: true */ /* @vite-ignore */ url) as Promise<
    Record<string, unknown>
  >;

/** A plugin whose module is at a URL. */
export interface RemotePluginRef {
  name: string;
  version?: string;
  displayName?: string;
  description?: string;
  octicon?: string;
  emoji?: string;
  /** Absolute or root-relative URL of the module. */
  entry: string;
  /** Which export holds the plugin. Empty or absent means the default. */
  export?: string;
  /** Refused if it is not what this runtime speaks. */
  apiVersion?: string;
  dependencies?: LazyPluginRef['dependencies'];
  activationEvents?: ActivationEvent[];
  deactivationEvents?: ActivationEvent[];
  requiredBackendPlugins?: string[];
  optionalBackendPlugins?: string[];
}

export type DefineRemoteOptions = {
  /** Override how the module is fetched — a test's seam, and MF's later. */
  loader?: RemoteModuleLoader;
  /** What this host speaks. Defaults to {@link REACTOR_API_VERSION}. */
  apiVersion?: string;
  /**
   * Origins a remote may be loaded from, beyond the page's own.
   *
   * A remote runs in the shell's origin with the shell's privileges, so
   * "anywhere" is not a default anybody should get by accident. Same-origin
   * always passes; anything else has to be named.
   */
  allowedOrigins?: string[];
};

/** Thrown by the loader, so the runtime reports it as a plugin that failed. */
class RemoteRefused extends Error {}

function assertAllowed(entry: string, allowed: string[] | undefined): void {
  // A root-relative URL is same-origin by construction; there is nothing to
  // check and nothing to resolve it against outside a browser.
  if (!/^[a-z]+:\/\//i.test(entry)) {
    return;
  }
  const origin = new URL(entry).origin;
  const here =
    typeof location !== 'undefined' && location?.origin ? location.origin : undefined;
  if (origin === here) {
    return;
  }
  if (allowed?.includes(origin)) {
    return;
  }
  throw new RemoteRefused(
    `Refusing to load a remote from ${origin}: not an allowed origin. ` +
      'Pass allowedOrigins to accept it.',
  );
}

/**
 * Declare a plugin whose module is fetched from a URL.
 *
 * Returns a `LazyPluginRef`, so the result goes into
 * `buildReactorFromPlugins` beside plugins that were bundled — and is listed,
 * described and switchable from the first frame, exactly like any other lazy
 * plugin, while its module is still on the wire.
 */
export function defineRemotePlugin(
  ref: RemotePluginRef,
  options: DefineRemoteOptions = {},
): LazyPluginRef {
  const {
    loader = importRemoteModule,
    apiVersion = REACTOR_API_VERSION,
    allowedOrigins,
  } = options;

  return defineLazyPlugin({
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
    load: async () => {
      if (ref.apiVersion && ref.apiVersion !== apiVersion) {
        throw new RemoteRefused(
          `${ref.name} declares API version ${ref.apiVersion}; this host speaks ${apiVersion}.`,
        );
      }
      assertAllowed(ref.entry, allowedOrigins);

      const missing = missingSharedModules();
      if (missing.length > 0) {
        console.warn(
          `[reactor] loading ${ref.name} from ${ref.entry} with these modules unpublished: ` +
            `${missing.join(', ')}. If it reaches for one it will get its own copy — ` +
            'call setReactorSharedModules() from the host before loading remotes.',
        );
      }

      const module = await loader(ref.entry);
      const exported = ref.export ? module[ref.export] : module.default ?? module;
      if (!exported) {
        throw new Error(
          `${ref.name}: ${ref.entry} has no ${ref.export ? `export "${ref.export}"` : 'default export'}.`,
        );
      }
      return exported as never;
    },
  });
}

/** One extension, as `GET /plugins/frontend-extensions` reports it. */
export type FrontendExtensionRecord = {
  name: string;
  version?: string;
  displayName?: string;
  description?: string;
  octicon?: string;
  emoji?: string;
  apiVersion?: string;
  kind?: string;
  entry: string;
  plugins: Array<Omit<RemotePluginRef, 'entry' | 'apiVersion'> & { export?: string }>;
};

export type BootstrapOptions = DefineRemoteOptions & {
  /** Swap the fetch, for tests and for hosts with their own client. */
  fetchJson?: (url: string) => Promise<unknown>;
};

/**
 * Ask a Reactor backend what frontend extensions are installed, and turn the
 * answer into plugins.
 *
 * This is the browser end of "one `pip install`, both tiers". Call it before
 * building the platform:
 *
 * ```ts
 * const remotes = await bootstrapExtensions('http://localhost:8799');
 * const reactor = buildReactorFromPlugins([...bundledPlugins, ...remotes]);
 * ```
 *
 * The server rescans what is installed when this is called, so an extension
 * that was `pip install`ed a minute ago into a *running* server is in the
 * answer. A page refresh is therefore the whole reload mechanism — there is no
 * watcher, and nothing restarts.
 *
 * A backend that cannot be reached yields an empty list rather than throwing.
 * A shell that refused to start because the extension server was down would be
 * failing for the wrong reason: its own bundled plugins are fine.
 */
export async function bootstrapExtensions(
  backendUrl: string,
  options: BootstrapOptions = {},
): Promise<(LazyPluginRef | ReactorExtension)[]> {
  const { fetchJson, ...remoteOptions } = options;
  const url = `${backendUrl.replace(/\/$/, '')}/plugins/frontend-extensions`;

  let records: FrontendExtensionRecord[];
  try {
    const answer = fetchJson
      ? await fetchJson(url)
      : await fetch(url).then((response) => {
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
          }
          return response.json();
        });
    records = (answer ?? []) as FrontendExtensionRecord[];
  } catch (error) {
    console.warn(`[reactor] could not read ${url}:`, error);
    return [];
  }

  return records.map((extension) => {
    // Relative entries are resolved against the backend, not the page: the
    // server that listed the extension is the server serving it.
    const entry = /^[a-z]+:\/\//i.test(extension.entry)
      ? extension.entry
      : `${backendUrl.replace(/\/$/, '')}${extension.entry}`;

    const plugins = (extension.plugins ?? []).map((plugin) =>
      defineRemotePlugin(
        { ...plugin, entry, apiVersion: extension.apiVersion },
        remoteOptions,
      ),
    );

    // Grouped, not flattened. The server knows these plugins arrived together
    // in one distribution, and dropping that on the way across the wire would
    // lose the only thing that answers "what would I uninstall to lose this?".
    // It is also the hierarchy the whole model rests on:
    //
    //     Python package  →  Extension  →  Plugin  →  Contribution  →  Point
    //
    // An extension still governs nothing — each plugin is switched on its own,
    // because grouping is about delivery.
    return defineExtension({
      name: extension.name,
      version: extension.version,
      displayName: extension.displayName,
      description: extension.description,
      octicon: extension.octicon,
      emoji: extension.emoji,
      plugins,
    });
  });
}
