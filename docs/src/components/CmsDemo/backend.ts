/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * `datalayer-cms`, in the browser.
 *
 * The CMS's server is a Python host that discovers extensions from an
 * entry-point group and serves each one's frontend out of the wheel it was
 * installed from. A documentation page has no Python, so this answers the same
 * endpoints — and, crucially, models the same *lifecycle*: an extension is
 * either installed or it is not, the list is rescanned when the browser asks,
 * and a package installed a moment ago is in the next answer.
 *
 * That is what makes the demo worth having rather than a screenshot. The button
 * on the page runs {@link pipInstall}, which does exactly what
 * `pip install cms-pro` does to the real server: adds a distribution to the
 * environment. Everything after that — the rescan, the manifests, the module
 * fetch, the three plugins appearing in three points — is the real runtime.
 *
 * @see /examples/cms/ for the packages this stands in for.
 */

/** One installed distribution, as the environment holds it. */
type Distribution = {
  /** The name `pip` knows it by. */
  distribution: string;
  /** The extension it advertises under the entry-point group. */
  name: string;
  displayName: string;
  description: string;
  emoji: string;
  /** The module the wheel ships, served from `/reactor-extensions/<name>/`. */
  module: string;
  /** The Python plugins it registers, as `GET /plugins` reports them. */
  backendPlugins: {
    name: string;
    display_name: string;
    description: string;
    emoji: string;
    enabled: boolean;
  }[];
  /** The browser plugins, as manifests — readable before the module is fetched. */
  plugins: {
    name: string;
    displayName: string;
    description: string;
    emoji: string;
    export: string;
  }[];
};

/** What `pip install cms` puts in the environment. */
const CMS: Distribution = {
  distribution: 'cms',
  name: 'Core',
  displayName: 'Core',
  description: 'The free tier: markdown tools, a gallery, and an SEO gate.',
  emoji: '🧱',
  module: '/cms-demo/cms-core.js',
  backendPlugins: [
    {
      name: 'cms.markdown-tools',
      display_name: 'Markdown Tools',
      description: 'Headings, bold, and a link.',
      emoji: '✍️',
      enabled: true,
    },
    {
      name: 'cms.gallery',
      display_name: 'Gallery',
      description: 'A content type for images with captions.',
      emoji: '🖼️',
      enabled: true,
    },
    {
      name: 'cms.seo-validator',
      display_name: 'SEO Validator',
      description: 'Refuses to publish a document that would be invisible.',
      emoji: '🔎',
      enabled: true,
    },
  ],
  plugins: [
    {
      name: '@cms/markdown-tools',
      displayName: 'Markdown Tools',
      description: 'Headings, bold and links, in the editor toolbar.',
      emoji: '✍️',
      export: 'MarkdownToolsPlugin',
    },
    {
      name: '@cms/gallery',
      displayName: 'Gallery',
      description: 'A content type for a set of images with captions.',
      emoji: '🖼️',
      export: 'GalleryPlugin',
    },
    {
      name: '@cms/seo-validator',
      displayName: 'SEO Validator',
      description: 'Stops a publish that would be invisible.',
      emoji: '🔎',
      export: 'SeoValidatorPlugin',
    },
  ],
};

/** What `pip install cms-pro` adds. Not installed until somebody asks. */
const CMS_PRO: Distribution = {
  distribution: 'cms-pro',
  name: 'Pro',
  displayName: 'Pro',
  description: 'The paid tier: an assistant, a product type, and social publishing.',
  emoji: '⭐',
  module: '/cms-demo/cms-pro.js',
  backendPlugins: [
    {
      name: 'cms.ai-writing-assistant',
      display_name: 'AI Writing Assistant',
      description: 'Rewrites a draft, and suggests beside the editor.',
      emoji: '🤖',
      enabled: true,
    },
    {
      name: 'cms.product',
      display_name: 'Product',
      description: 'A content type with a price and a SKU.',
      emoji: '🏷️',
      enabled: true,
    },
    {
      name: 'cms.social-publisher',
      display_name: 'Social Publisher',
      description: 'Announces a publish. Never blocks one.',
      emoji: '📣',
      enabled: true,
    },
  ],
  plugins: [
    {
      name: '@cms-pro/ai-writing-assistant',
      displayName: 'AI Writing Assistant',
      description: 'Rewrites a draft, and suggests beside the editor.',
      emoji: '🤖',
      export: 'AiWritingAssistantPlugin',
    },
    {
      name: '@cms-pro/product',
      displayName: 'Product',
      description: 'A content type with a price and a SKU.',
      emoji: '🏷️',
      export: 'ProductPlugin',
    },
    {
      name: '@cms-pro/social-publisher',
      displayName: 'Social Publisher',
      description: 'Announces a publish. Never blocks one.',
      emoji: '📣',
      export: 'SocialPublisherPlugin',
    },
  ],
};

/** The environment. Starts with the free tier, exactly as a `pip install cms` does. */
const installed = new Map<string, Distribution>([[CMS.distribution, CMS]]);

/** Bumped on every install and uninstall, like the platform's own revision. */
let revision = 1;

/** Notified when the environment changes, so the page can offer a refresh. */
const listeners = new Set<() => void>();

/**
 * The installed list, as one array that only changes when the list does.
 *
 * `useSyncExternalStore` compares snapshots by identity, so a getter that built
 * a fresh array on every call would report a change on every render — and React
 * would render again to find out about it, forever. Caching the array is not an
 * optimisation here; it is the difference between working and a loop.
 */
let snapshot: string[] = [...installedNames()];

function installedNames(): string[] {
  return [...installed.keys()];
}

function changed(): void {
  revision += 1;
  snapshot = installedNames();
  listeners.forEach((listener) => listener());
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** `pip install <distribution>`. */
export function pipInstall(distribution: string): void {
  const wheel = [CMS, CMS_PRO].find((one) => one.distribution === distribution);
  if (!wheel || installed.has(distribution)) {
    return;
  }
  installed.set(distribution, wheel);
  changed();
}

/** `pip uninstall <distribution>`. */
export function pipUninstall(distribution: string): void {
  if (installed.delete(distribution)) {
    changed();
  }
}

export function isInstalled(distribution: string): boolean {
  return installed.has(distribution);
}

export function installedDistributions(): string[] {
  return snapshot;
}

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

/** The endpoints `create_reactor_host` serves, for the paths the CMS uses. */
function route(pathname: string): Response {
  if (pathname === '/plugins/frontend-extensions') {
    // Rescanned on every call, which is the whole reason a browser refresh is
    // the reload mechanism for the real server too.
    return json(
      [...installed.values()].map((wheel) => ({
        name: wheel.name,
        version: '0.1.0',
        displayName: wheel.displayName,
        description: wheel.description,
        emoji: wheel.emoji,
        apiVersion: 'v1',
        kind: 'esm',
        entry: wheel.module,
        plugins: wheel.plugins,
        backendPlugins: wheel.backendPlugins.map((plugin) => plugin.name),
      })),
    );
  }

  if (pathname === '/plugins') {
    return json([...installed.values()].flatMap((wheel) => wheel.backendPlugins));
  }

  if (pathname === '/plugins/state') {
    return json({
      revision,
      plugins: [...installed.values()].flatMap((wheel) =>
        wheel.backendPlugins.map((plugin) => ({
          name: plugin.name,
          enabled: plugin.enabled,
          activated: true,
        })),
      ),
    });
  }

  if (pathname === '/extensions') {
    return json(
      [...installed.values()].map((wheel) => ({
        name: wheel.name,
        display_name: wheel.displayName,
        description: wheel.description,
        emoji: wheel.emoji,
        plugins: wheel.backendPlugins.map((plugin) => plugin.name),
      })),
    );
  }

  return json({ detail: 'Not Found' });
}

/**
 * The paths this shim answers, and only these.
 *
 * The CMS asks its own origin, which on this site is the documentation site —
 * so claiming the whole origin would swallow Docusaurus's own requests. An
 * allowlist of prefixes is the difference between standing in for a backend and
 * standing in for everything.
 */
const BACKEND_PATHS = ['/plugins', '/extensions', '/events'];

let armed = false;

/** Route the CMS's requests to {@link route}. Idempotent; never uninstalled. */
export function installMockHost(): void {
  if (armed || typeof window === 'undefined') {
    return;
  }
  armed = true;

  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url, window.location.href);
    const mine =
      url.origin === window.location.origin &&
      BACKEND_PATHS.some(
        (prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
      );
    return mine ? route(url.pathname) : original(input as RequestInfo, init);
  };
}
