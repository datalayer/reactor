/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/*
 * Copyright (c) 2025-2026 Datalayer, Inc.
 * Distributed under the terms of the Modified BSD License.
 */

/**
 * The music example's Python backend, in the browser.
 *
 * The example ships a real FastAPI host (`music_backend`) running four reactor
 * plugins on one `PluginPlatform`. A documentation page is a static file and
 * has no such host, so this module answers the same endpoints from a small
 * in-memory platform and installs itself over `window.fetch`.
 *
 * What is reproduced is the part the demo depends on — the same four plugins,
 * the same manifests, the same `GET /plugins` shape and the same
 * `POST /plugins/{name}/toggle` semantics — so the frontend plugins run
 * unmodified and every switch in the Plugins panel does on this page what it
 * does against uvicorn.
 *
 * What is *not* reproduced is anything the demo cannot show: there is no
 * dependency enforcement at registration (the registration order is fixed
 * here), no tenants, and no marketplace. Those are documented rather than
 * simulated.
 *
 * @see /examples/music/backend for the real thing.
 */

/** The port the example's uvicorn host listens on; the plugins hard-code it. */
const BACKEND_ORIGIN = 'http://localhost:8799';

type Song = {
  id: string;
  title: string;
  artist: string;
  price: number;
};

/** `catalog_plugin.catalog.SONGS`, verbatim. */
const SONGS: Song[] = [
  { id: 's1', title: 'Quantum Sunrise', artist: 'Nova Fields', price: 1.29 },
  { id: 's2', title: 'Neon Harbor', artist: 'The Lumen', price: 0.99 },
  { id: 's3', title: 'Gravity Waltz', artist: 'Ada Cole', price: 1.49 },
  { id: 's4', title: 'Paper Satellites', artist: 'Kite Museum', price: 1.09 },
  { id: 's5', title: 'Midnight Kernel', artist: 'Root Access', price: 1.19 },
  { id: 's6', title: 'Analog Dreams', artist: 'Vela Bloom', price: 0.89 },
];

/** One row of `GET /plugins`, as the reactor management API serves it. */
type BackendPlugin = {
  name: string;
  version: string;
  display_name: string;
  description: string;
  octicon: string;
  emoji: string;
  dependencies: string[];
  frontend_dependencies: string[];
  optional_frontend_dependencies: string[];
  contribution_points: string[];
  enabled: boolean;
};

/**
 * The four `PluginManifest`s the music backend registers, in dependency order.
 *
 * Kept in step with the Python packages by hand. They are the same four fields
 * the TypeScript tier declares, which is the point the Plugins panel makes:
 * one overlay draws a plugin from either side of the wire.
 */
const PLUGINS: BackendPlugin[] = [
  {
    name: 'catalog',
    version: '1.0.0',
    display_name: 'Catalog',
    description: 'Serves the song catalog every other plugin reads.',
    octicon: 'book',
    emoji: '🎵',
    dependencies: [],
    frontend_dependencies: [],
    optional_frontend_dependencies: [],
    contribution_points: [],
    enabled: true,
  },
  {
    name: 'checkout',
    version: '1.0.0',
    display_name: 'Checkout',
    description: 'Prices a cart against the catalog and turns it into an order.',
    octicon: 'credit-card',
    emoji: '💳',
    dependencies: ['catalog'],
    frontend_dependencies: ['@music/checkout'],
    optional_frontend_dependencies: [],
    contribution_points: [],
    enabled: true,
  },
  {
    name: 'playlist',
    version: '1.0.0',
    display_name: 'Playlist',
    description:
      'Opens the music.playlistRule extension point and serves what is contributed to it.',
    octicon: 'list-unordered',
    emoji: '🎧',
    dependencies: ['catalog'],
    frontend_dependencies: [],
    optional_frontend_dependencies: ['@music/playlist'],
    contribution_points: ['music.playlistRule'],
    enabled: true,
  },
  {
    name: 'mood',
    version: '1.0.0',
    display_name: 'Moods',
    description: "Three rules contributed to the playlist plugin's extension point.",
    octicon: 'sun',
    emoji: '🌤️',
    dependencies: ['playlist'],
    frontend_dependencies: [],
    optional_frontend_dependencies: ['@music/mood'],
    contribution_points: [],
    enabled: true,
  },
];

/** What `mood_plugin` contributes to `music.playlistRule`. */
const PLAYLIST_RULES = [
  { id: 'chill', title: 'Chill', description: 'Four gentle tracks, cheapest first', plugin: 'mood' },
  { id: 'energetic', title: 'Energetic', description: 'Everything, loudest bill first', plugin: 'mood' },
  { id: 'a-to-z', title: 'A to Z', description: 'Every track, by title', plugin: 'mood' },
];

/**
 * The platform's state for the life of the page.
 *
 * Module-level rather than per-mount: the panel's switches must survive a
 * React remount the same way the server survives a page refresh, and there is
 * only ever one backend.
 */
const state = {
  plugins: PLUGINS.map(plugin => ({ ...plugin })),
};

const isEnabled = (name: string): boolean =>
  state.plugins.some(plugin => plugin.name === name && plugin.enabled);

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** Route one request the way `create_reactor_app` plus the plugin routers do. */
async function route(request: Request, url: URL): Promise<Response> {
  const { pathname } = url;

  // --- The reactor's own management API -----------------------------------

  if (pathname === '/plugins' && request.method === 'GET') {
    return json(state.plugins);
  }

  const toggle = pathname.match(/^\/plugins\/([^/]+)\/toggle$/);
  if (toggle && request.method === 'POST') {
    const name = decodeURIComponent(toggle[1]);
    const plugin = state.plugins.find(entry => entry.name === name);
    if (!plugin) {
      return json({ detail: `Unknown plugin '${name}'` }, 404);
    }
    const body = (await request.json().catch(() => ({}))) as { enabled?: boolean };
    plugin.enabled = body.enabled ?? !plugin.enabled;
    return json({ name: plugin.name, enabled: plugin.enabled });
  }

  if (pathname === '/extensions' && request.method === 'GET') {
    // The example's backend host registers plugins individually; it groups
    // none of them, and says so rather than inventing an extension.
    return json([]);
  }

  // --- The catalog plugin's router ----------------------------------------

  if (pathname === '/api/catalog/songs') {
    if (!isEnabled('catalog')) {
      return json({ detail: "Plugin 'catalog' is disabled" }, 404);
    }
    return json(SONGS);
  }

  // --- The checkout plugin's router ---------------------------------------

  if (pathname === '/api/checkout' && request.method === 'POST') {
    if (!isEnabled('checkout')) {
      return json({ detail: "Plugin 'checkout' is disabled" }, 404);
    }
    const body = (await request.json().catch(() => ({}))) as {
      items?: { id: string; quantity?: number }[];
    };
    const lines = (body.items ?? []).flatMap(item => {
      const song = SONGS.find(entry => entry.id === item.id);
      if (!song) {
        return [];
      }
      const quantity = item.quantity ?? 1;
      return [{ ...song, quantity, subtotal: Number((song.price * quantity).toFixed(2)) }];
    });
    const total = lines.reduce((sum, line) => sum + line.subtotal, 0);
    return json({ lines, total: Number(total.toFixed(2)) });
  }

  // --- The playlist plugin's router ---------------------------------------
  //
  // Built from the platform rather than from a constant, in the same spirit as
  // `build_playlist_router`: the rules are read per request, so switching the
  // `mood` plugin off empties this answer without restarting anything.

  if (pathname === '/api/playlist/rules') {
    if (!isEnabled('playlist')) {
      return json({ detail: "Plugin 'playlist' is disabled" }, 404);
    }
    return json(isEnabled('mood') ? PLAYLIST_RULES : []);
  }

  if (pathname === '/api/playlist') {
    if (!isEnabled('playlist')) {
      return json({ detail: "Plugin 'playlist' is disabled" }, 404);
    }
    const rules = isEnabled('mood') ? PLAYLIST_RULES : [];
    const wanted = url.searchParams.get('rule') ?? rules[0]?.id;
    const rule = rules.find(entry => entry.id === wanted);
    if (!rule) {
      return json({ rule: null, songs: [] });
    }
    const by = {
      chill: [...SONGS].sort((a, b) => a.price - b.price).slice(0, 4),
      energetic: [...SONGS].sort((a, b) => b.price - a.price),
      'a-to-z': [...SONGS].sort((a, b) => a.title.localeCompare(b.title)),
    }[rule.id];
    return json({ rule: rule.id, songs: by ?? [] });
  }

  return json({ detail: 'Not Found' }, 404);
}

let installed = false;

/**
 * Route every request aimed at the example's backend to {@link route}.
 *
 * Idempotent, and deliberately not undone: React StrictMode mounts the demo
 * twice, and a shim that uninstalled itself on the first unmount would leave
 * the second mount talking to a port nobody is listening on.
 */
export function installMockBackend(): void {
  if (installed || typeof window === 'undefined') {
    return;
  }
  installed = true;

  const original = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input as RequestInfo, init);
    const url = new URL(request.url, window.location.href);
    if (url.origin !== BACKEND_ORIGIN) {
      return original(input as RequestInfo, init);
    }
    return route(request, url);
  };
}
