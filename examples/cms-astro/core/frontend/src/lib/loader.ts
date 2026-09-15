/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import type { LiveLoader } from 'astro/loaders';

import type { Entry } from './cms';

export type CmsEntryFilter = { id?: string; slug?: string };
export type CmsCollectionFilter = { limit?: number };

export type CmsLoaderOptions = {
  apiUrl?: string;
  site?: string;
  collection: string;
};

/** Astro 6 live loader backed by the Core public API and SQLite. */
export function cmsLoader(options: CmsLoaderOptions): LiveLoader<Entry, CmsEntryFilter, CmsCollectionFilter> {
  const apiUrl = options.apiUrl ?? process.env.CMS_API_URL ?? 'http://localhost:8791';
  const site = options.site ?? process.env.CMS_SITE ?? 'acme';

  async function json<T>(path: string): Promise<T> {
    const response = await fetch(`${apiUrl}${path}`);
    if (!response.ok) throw new Error(`CMS ${response.status}: ${await response.text()}`);
    return response.json() as Promise<T>;
  }

  return {
    name: `datalayer-cms:${site}:${options.collection}`,
    async loadCollection({ filter }) {
      const limit = Math.min(Math.max(filter?.limit ?? 20, 1), 100);
      const items = await json<Entry[]>(
        `/api/content/${encodeURIComponent(site)}/entries?collection=${encodeURIComponent(options.collection)}&limit=${limit}`,
      );
      return {
        entries: items.map((item) => ({
          id: item.id,
          data: item,
          cacheHint: { tags: [`cms-site:${site}`, `cms-collection:${options.collection}`, `cms-entry:${item.id}`] },
        })),
        cacheHint: { tags: [`cms-site:${site}`, `cms-collection:${options.collection}`] },
      };
    },
    async loadEntry({ filter }) {
      const slug = filter.slug ?? filter.id;
      if (!slug) return { error: new Error('A CMS entry slug or id is required') };
      try {
        const item = await json<Entry>(`/api/content/${encodeURIComponent(site)}/entries/${encodeURIComponent(slug)}`);
        if (item.collection && item.collection !== options.collection) return undefined;
        return { id: item.id, data: item, cacheHint: { tags: [`cms-entry:${item.id}`] } };
      } catch (error) {
        return { error: error instanceof Error ? error : new Error(String(error)) };
      }
    },
  };
}
