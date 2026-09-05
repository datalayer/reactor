/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Remotes delivered as Module Federation containers.
 *
 * {@link module:core/remote} loads a remote as a plain ES module: one URL, one
 * `import()`, and a `shared` registry the host fills by hand. That is enough to
 * prove the lifecycle, and it stops being enough the moment two remotes want
 * the same library at compatible-but-not-identical versions. Nothing in a bare
 * `import()` can negotiate that — the second remote gets a second copy, and if
 * the library is React the failure arrives as hooks throwing inside somebody
 * else's component.
 *
 * A Module Federation container answers exactly that question, and three
 * others this module exposes:
 *
 * 1. **Shared-dependency negotiation.** The host publishes what it has and the
 *    version it is; a container asks for what it needs and the range it will
 *    accept; the runtime picks one copy or says why it cannot.
 * 2. **Version compatibility, per module.** `REACTOR_API_VERSION` already
 *    refuses a remote built against a different runtime. Sharing adds the
 *    finer-grained answer: this remote wants `react@^18`, the host has 19, and
 *    the mismatch is reported by name rather than discovered in a render.
 * 3. **Hot updates.** A container is registered by name, so re-registering it
 *    with a new entry swaps the code behind a plugin that is already running —
 *    what {@link updateFederatedRemote} does.
 *
 * The runtime SDK is loaded on demand and is an *optional* peer dependency: a
 * host that never loads a container never pays for it, and `@datalayer/reactor`
 * keeps a dependency list you can read in one breath. This is also why the SDK
 * is reached through a structural type rather than an import of its types —
 * the package may legitimately not be installed.
 *
 * What this module is not: a bundler. Building a container is
 * `pluginModuleFederation` in Rsbuild, or its equivalent elsewhere, and it
 * happens in the *remote's* repository. The host only consumes.
 *
 * @module core/federation
 */

import { defineRemotePlugin, getReactorSharedModules, type DefineRemoteOptions, type RemoteModuleLoader, type RemotePluginRef } from './remote';
import type { LazyPluginRef } from './plugin';

/* ── The SDK, as little of it as is used ──────────────────────────────── */

/** What a host publishes about one shared module. */
export type FederationShareSpec = {
  /** The copy itself. A thunk, so nothing is touched until it is wanted. */
  lib: () => unknown;
  /** What the host has. Used to answer a remote's `requiredVersion`. */
  version?: string;
  shareConfig?: {
    singleton?: boolean;
    requiredVersion?: string | false;
    eager?: boolean;
  };
};

/** One container the host knows how to reach. */
export type FederationRemoteEntry = {
  /** The container's own name — what its build declared. */
  name: string;
  /** URL of the container entry, usually `remoteEntry.js`. */
  entry: string;
  alias?: string;
  /**
   * How the entry is built: `global` (the bundlers' default, a script that
   * sets `globalThis[entryGlobalName]`), `esm` (a module exporting `init` and
   * `get`), `system`, … Left unset, the runtime decides from the URL.
   */
  type?: string;
  /** The global the entry sets, when `type` is `global`. Defaults to `name`. */
  entryGlobalName?: string;
  /** Which share scope to negotiate in. `default` unless the host says. */
  shareScope?: string;
};

/**
 * The slice of `@module-federation/runtime` this module uses.
 *
 * Structural on purpose: the package is optional, so its types cannot be
 * imported, and naming only what is used keeps the coupling to four functions.
 */
export type FederationRuntime = {
  init(options: {
    name: string;
    remotes: FederationRemoteEntry[];
    shared?: Record<string, FederationShareSpec | FederationShareSpec[]>;
  }): unknown;
  loadRemote<T = unknown>(id: string): Promise<T | null>;
  registerRemotes(
    remotes: FederationRemoteEntry[],
    options?: { force?: boolean },
  ): void;
  preloadRemote(options: Array<{ nameOrAlias: string }>): Promise<unknown>;
};

let runtimeOverride: FederationRuntime | undefined;
let runtimeLoad: Promise<FederationRuntime> | undefined;

/**
 * Use this runtime instead of importing the SDK.
 *
 * For tests, and for a host that already initialised Module Federation through
 * its own bundler and wants Reactor to use that instance rather than a second
 * one. Pass `undefined` to go back to the SDK.
 */
export function setFederationRuntime(runtime: FederationRuntime | undefined): void {
  runtimeOverride = runtime;
  runtimeLoad = undefined;
}

/**
 * The SDK, imported the first time a container is actually wanted.
 *
 * The specifier is in a variable so a bundler cannot decide it is a static
 * dependency and pull the SDK into a host that never federates anything.
 */
async function federationRuntime(): Promise<FederationRuntime> {
  if (runtimeOverride) {
    return runtimeOverride;
  }
  if (!runtimeLoad) {
    const specifier = '@module-federation/runtime';
    runtimeLoad = import(/* @vite-ignore */ /* webpackIgnore: true */ specifier)
      .then((module) => (module.default ?? module) as FederationRuntime)
      .catch((error) => {
        runtimeLoad = undefined;
        throw new Error(
          'Loading a Module Federation container needs @module-federation/runtime, ' +
            'which is an optional peer dependency of @datalayer/reactor. ' +
            `Install it, or pass a loader of your own. (${String(error)})`,
        );
      });
  }
  return runtimeLoad;
}

/* ── Sharing ──────────────────────────────────────────────────────────── */

/** The host's name in the federation graph, when it does not pick one. */
const HOST_NAME = 'datalayer_reactor_host';

/**
 * Turn what the host published into what the federation runtime negotiates
 * with.
 *
 * {@link setReactorSharedModules} is already the host's statement of "these are
 * mine, borrow them rather than bundling your own". This says the same thing in
 * the runtime's vocabulary, so a host declares its singletons **once**.
 *
 * Everything is a singleton by default and `requiredVersion` is off. That pair
 * is deliberate: React and the reactor itself are singletons or nothing works,
 * and a host that has not said which version it has should not have remotes
 * refused over a version nobody declared. Pass `versions` to tighten it.
 */
export function sharedFromHost(
  versions: Record<string, string> = {},
  overrides: Record<string, Partial<FederationShareSpec>> = {},
): Record<string, FederationShareSpec> {
  const published = getReactorSharedModules();
  const shared: Record<string, FederationShareSpec> = {};
  for (const [name, value] of Object.entries(published)) {
    // `shareConfig` is merged a level deeper than the rest: an override that
    // says `{ singleton: false }` means that one field, not "and forget
    // `requiredVersion`".
    const { shareConfig, ...override } = overrides[name] ?? {};
    shared[name] = {
      lib: () => value,
      version: versions[name],
      ...override,
      shareConfig: { singleton: true, requiredVersion: false, ...shareConfig },
    };
  }
  return shared;
}

/* ── The host ─────────────────────────────────────────────────────────── */

export type InitFederationOptions = {
  /** This host's name in the federation graph. */
  name?: string;
  /** Containers known up front. More can arrive through {@link registerFederatedRemote}. */
  remotes?: FederationRemoteEntry[];
  /**
   * What the host shares. Defaults to {@link sharedFromHost}, i.e. exactly
   * what `setReactorSharedModules` published.
   */
  shared?: Record<string, FederationShareSpec>;
  /** Versions for the published modules, so `requiredVersion` can be answered. */
  versions?: Record<string, string>;
};

let initialised: Promise<FederationRuntime> | undefined;

/**
 * Stand up the federation host, once.
 *
 * Call it after `setReactorSharedModules` and before building the platform.
 * Idempotent: a second call returns the first host rather than replacing it,
 * because two federation hosts in one page share nothing with each other and
 * the second one's remotes would quietly get their own React.
 */
export async function initReactorFederation(
  options: InitFederationOptions = {},
): Promise<FederationRuntime> {
  if (initialised) {
    return initialised;
  }
  const pending = (async () => {
    const runtime = await federationRuntime();
    runtime.init({
      name: options.name ?? HOST_NAME,
      remotes: options.remotes ?? [],
      shared: options.shared ?? sharedFromHost(options.versions),
    });
    return runtime;
  })();
  initialised = pending;
  // A failure — the SDK not installed, most often — is reported to this caller
  // and forgotten, so the next call tries again rather than replaying the same
  // rejection after the runtime has been provided through `setFederationRuntime`.
  pending.catch(() => {
    if (initialised === pending) {
      initialised = undefined;
    }
  });
  return pending;
}

/** Forget the host. For tests, and for a shell that tears itself down. */
export function resetReactorFederation(): void {
  initialised = undefined;
}

/**
 * Make a container reachable, or point an existing name at new code.
 *
 * `force` is the whole hot-update story: Module Federation keys a container by
 * name, so re-registering the same name with a different entry is how new code
 * gets behind a plugin that is already running.
 */
export async function registerFederatedRemote(
  remote: FederationRemoteEntry,
  options: { force?: boolean } = {},
): Promise<void> {
  const runtime = await initReactorFederation();
  runtime.registerRemotes([remote], { force: options.force ?? false });
}

/**
 * Point a container at new code and pull it in.
 *
 * What a plugin author wants during development and what a marketplace wants
 * after a publish. The entry is cache-busted unless the caller gives one:
 * `remoteEntry.js` is the most cacheable filename in the ecosystem, and an
 * update that fetched the cached copy would look like a no-op.
 *
 * Plugins already built from this container keep running; what changes is the
 * code behind the *next* module the container hands out. A plugin that must
 * itself be replaced is `reactor.uninstall()` then `reactor.install()`, which
 * is the same story a local plugin has.
 */
export async function updateFederatedRemote(
  name: string,
  entry: string,
  options: { bust?: boolean } = {},
): Promise<void> {
  const bust = options.bust ?? true;
  const url = bust
    ? `${entry}${entry.includes('?') ? '&' : '?'}t=${Date.now()}`
    : entry;
  await registerFederatedRemote({ name, entry: url }, { force: true });
  const runtime = await initReactorFederation();
  await runtime.preloadRemote([{ nameOrAlias: name }]);
}

/* ── The loader ───────────────────────────────────────────────────────── */

/**
 * A {@link RemoteModuleLoader} that reads a Module Federation container.
 *
 * This is the swap the roadmap promised: `defineRemotePlugin` does not change,
 * the lifecycle does not change, and the only thing that moves is how the
 * module is fetched. A ref with a `scope` is a container; one without is a
 * plain ES module and never reaches here.
 */
export function createFederationLoader(): RemoteModuleLoader {
  return async (entry, ref) => {
    const scope = ref?.scope;
    if (!scope) {
      throw new Error(
        `${ref?.name ?? entry}: the federation loader needs a container name — ` +
          'pass `scope` on the remote reference.',
      );
    }
    await registerFederatedRemote({ name: scope, entry, type: ref?.type });
    const runtime = await initReactorFederation();
    const id = `${scope}/${(ref?.module ?? './plugin').replace(/^\.\//, '')}`;
    const module = await runtime.loadRemote<Record<string, unknown>>(id);
    if (!module) {
      throw new Error(
        `${ref?.name ?? scope}: the container at ${entry} exposes no ${id}.`,
      );
    }
    return module;
  };
}

/** One loader is enough: the runtime it talks to is a singleton anyway. */
const federationLoader = createFederationLoader();

/** A plugin that lives inside a Module Federation container. */
export type FederatedPluginRef = Omit<RemotePluginRef, 'scope' | 'module'> & {
  /** The container's name, as its build declared it. */
  scope: string;
  /** Which exposed module holds the plugin. `./plugin` by default. */
  module?: string;
  /** How the entry is built — `global` by default, `esm` for a module. */
  type?: string;
};

/**
 * Declare a plugin delivered as a Module Federation container.
 *
 * The manifest half is identical to {@link defineRemotePlugin} — and that is
 * the point of the whole design. A host lists, describes, draws and switches
 * the plugin from the first frame; whether the module behind it arrives as an
 * ES module or a negotiated container is a delivery detail the host states
 * once, here.
 *
 * ```ts
 * defineFederatedPlugin({
 *   name: '@acme/charts',
 *   displayName: 'Charts',
 *   entry: 'https://cdn.acme.com/charts/remoteEntry.js',
 *   scope: 'acme_charts',
 *   module: './plugin',
 *   activationEvents: [onView('charts')],
 * });
 * ```
 */
export function defineFederatedPlugin(
  ref: FederatedPluginRef,
  options: DefineRemoteOptions = {},
): LazyPluginRef {
  return defineRemotePlugin(ref, { loader: federationLoader, ...options });
}
