/** Typed, request-time CMS client for Astro SSR pages. */

const baseUrl = import.meta.env.CMS_API_URL ?? 'http://localhost:8791';

export type Entry = {
  id: string;
  slug: string;
  collection?: string;
  title: string;
  excerpt: string;
  body: string;
  data: Record<string, unknown>;
  published_at: string;
};

export type Bootstrap = {
  site: {
    id: string;
    slug: string;
    name: string;
    tagline: string;
    theme_slug: string;
    theme_name: string;
    tokens: { accent?: string; font?: string };
  };
  settings: Record<string, string>;
  menus: Array<{ id: string; slug: string; name: string; items: Array<{ id: string; label: string; url: string }> }>;
  widgets: Array<{ id: string; area: string; kind: string; data: Record<string, unknown> }>;
};

async function get<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, init);
  if (!response.ok) throw new Error(`CMS ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

export const cms = {
  bootstrap: (site = 'acme') => get<Bootstrap>(`/api/content/${site}/bootstrap`),
  entries: (site = 'acme', collection = 'posts') =>
    get<Entry[]>(`/api/content/${site}/entries?collection=${encodeURIComponent(collection)}`),
  entry: (slug: string, site = 'acme') => get<Entry>(`/api/content/${site}/entries/${encodeURIComponent(slug)}`),
  adminEntries: (site = 'site-main', user = 'u-admin') =>
    get<Array<Entry & { status: string }>>(`/api/cms/sites/${site}/entries`, { headers: { 'X-CMS-User': user } }),
};
