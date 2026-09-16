/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import type { FrontendToolDefinition } from '@datalayer/agent-runtimes/lib/types/tools';

export type CmsSiteSession = {
  token: string;
  user: { id: string; username: string; name: string };
  memberships: Array<{ site_id: string; role: string }>;
};

type ToolContext = { apiUrl: string; siteId: string; session: CmsSiteSession };
type Collection = 'posts' | 'pages';
type EntryResult = { id: string; slug: string; status: string };
type CmsEntry = EntryResult & {
  collection: Collection;
  title: string;
  excerpt: string;
  body: string;
  data?: Record<string, unknown>;
  updated_at?: string;
  published_at?: string;
};
type RefreshResult = { requestId?: string; url: string; error?: string };

const refreshEvent = 'cms-astro:refresh-view';
const refreshedEvent = 'cms-astro:view-refreshed';

async function cmsRequest<T>(
  context: ToolContext,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${context.apiUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${context.session.token}`,
      ...init.headers,
    },
  });
  if (!response.ok) {
    let message = `CMS request failed with HTTP ${response.status}`;
    try {
      message = ((await response.json()) as { detail?: string }).detail ?? message;
    } catch {
      // Keep the HTTP fallback for a non-JSON response.
    }
    throw new Error(message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function result(entry: EntryResult, collection: Collection, message: string) {
  return {
    id: entry.id,
    slug: entry.slug,
    status: entry.status,
    public_url: `/${collection === 'posts' ? 'posts' : 'pages'}/${entry.slug}`,
    message,
  };
}

function entryPath(
  context: ToolContext,
  values: { entry_id?: string; slug?: string; collection?: Collection },
): string {
  if (values.entry_id) {
    return `/api/cms/sites/${context.siteId}/entries/${encodeURIComponent(values.entry_id)}`;
  }
  if (!values.slug || !values.collection) {
    throw new Error('Provide entry_id, or provide both slug and collection.');
  }
  return `/api/cms/sites/${context.siteId}/entries/by-slug/${encodeURIComponent(values.slug)}?collection=${values.collection}`;
}

async function readEntry(
  context: ToolContext,
  values: { entry_id?: string; slug?: string; collection?: Collection },
): Promise<CmsEntry> {
  return cmsRequest<CmsEntry>(context, entryPath(context, values));
}

function readableEntry(entry: CmsEntry) {
  return {
    id: entry.id,
    collection: entry.collection,
    title: entry.title,
    slug: entry.slug,
    excerpt: entry.excerpt,
    body: entry.body,
    status: entry.status,
    source_url: entry.data?.source_url,
    content_format:
      typeof entry.data?.lexical === 'string' ? 'lexical_with_plain_text_body' : 'markdown',
    updated_at: entry.updated_at,
    published_at: entry.published_at,
    public_url: `/${entry.collection === 'posts' ? 'posts' : 'pages'}/${entry.slug}`,
  };
}

function currentPageReference(): { collection: Collection; slug: string } {
  const segments = window.location.pathname.split('/').filter(Boolean);
  if (segments.length !== 2 || !['posts', 'pages', 'premium'].includes(segments[0])) {
    throw new Error('The current route is not an individual CMS post or page.');
  }
  return {
    collection: segments[0] === 'pages' ? 'pages' : 'posts',
    slug: decodeURIComponent(segments[1]),
  };
}

function refreshCurrentView(): Promise<Record<string, unknown>> {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      document.removeEventListener(refreshedEvent, onRefreshed);
      reject(new Error('This page does not support an in-place CMS refresh.'));
    }, 15_000);
    const onRefreshed = (event: Event) => {
      const detail = (event as CustomEvent<RefreshResult>).detail;
      if (detail?.requestId !== requestId) return;
      window.clearTimeout(timeout);
      document.removeEventListener(refreshedEvent, onRefreshed);
      if (detail.error) {
        reject(new Error(detail.error));
        return;
      }
      resolve({
        refreshed: true,
        url: detail.url,
        message: 'The current Astro view was refreshed without reloading the browser tab.',
      });
    };
    document.addEventListener(refreshedEvent, onRefreshed);
    document.dispatchEvent(new CustomEvent(refreshEvent, { detail: { requestId } }));
  });
}

function crawlTool(
  context: ToolContext,
  kind: 'blog' | 'feed' | 'wordpress',
): FrontendToolDefinition {
  const names = {
    blog: 'cms_crawl_blog',
    feed: 'cms_crawl_feed',
    wordpress: 'cms_crawl_wordpress',
  } as const;
  const descriptions = {
    blog: 'Crawl content pages linked from a public blog index without changing the CMS.',
    feed: 'Read an RSS or Atom feed and crawl its linked article pages without changing the CMS.',
    wordpress:
      'Discover a public WordPress REST API and return its latest posts without changing the CMS.',
  } as const;
  return {
    name: names[kind],
    description: descriptions[kind],
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Public http or https blog URL.' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['url'],
    },
    handler: (args) => {
      const { url, limit = 12 } = args as { url: string; limit?: number };
      return cmsRequest(context, `/api/cms/sites/${context.siteId}/crawl/${kind}`, {
        method: 'POST',
        body: JSON.stringify({ url, limit }),
      });
    },
  };
}

export function createCmsAgentTools(context: ToolContext): FrontendToolDefinition[] {
  return [
    crawlTool(context, 'blog'),
    crawlTool(context, 'feed'),
    crawlTool(context, 'wordpress'),
    {
      name: 'cms_create_site_page',
      description: 'Create a post or standalone page. It remains a draft unless publish is true.',
      parameters: {
        type: 'object',
        properties: {
          collection: { type: 'string', enum: ['posts', 'pages'] },
          title: { type: 'string' },
          slug: { type: 'string' },
          excerpt: { type: 'string' },
          body: { type: 'string' },
          source_url: { type: 'string' },
          publish: { type: 'boolean' },
        },
        required: ['collection', 'title', 'body'],
      },
      handler: async (args) => {
        const values = args as {
          collection: Collection;
          title: string;
          slug?: string;
          excerpt?: string;
          body: string;
          source_url?: string;
          publish?: boolean;
        };
        let entry = await cmsRequest<EntryResult>(
          context,
          `/api/cms/sites/${context.siteId}/entries`,
          {
            method: 'POST',
            body: JSON.stringify({
              collection: values.collection,
              title: values.title,
              slug: values.slug,
              excerpt: values.excerpt ?? '',
              body: values.body,
              data: values.source_url ? { source_url: values.source_url } : {},
            }),
          },
        );
        if (values.publish) {
          entry = await cmsRequest<EntryResult>(
            context,
            `/api/cms/sites/${context.siteId}/entries/${entry.id}/publish`,
            { method: 'POST' },
          );
        }
        return result(
          entry,
          values.collection,
          values.publish ? 'Page created and published.' : 'Draft page created.',
        );
      },
    },
    {
      name: 'cms_list_site_pages',
      description:
        'List posts and standalone pages in the current site, optionally filtered by collection or publication status.',
      parameters: {
        type: 'object',
        properties: {
          collection: { type: 'string', enum: ['posts', 'pages'] },
          status: { type: 'string', enum: ['draft', 'published'] },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
      handler: async (args) => {
        const values = args as { collection?: Collection; status?: string; limit?: number };
        const query = values.status ? `?status=${encodeURIComponent(values.status)}` : '';
        const entries = await cmsRequest<CmsEntry[]>(
          context,
          `/api/cms/sites/${context.siteId}/entries${query}`,
        );
        const pages = entries
          .filter((entry) => !values.collection || entry.collection === values.collection)
          .slice(0, values.limit ?? 50)
          .map((entry) => {
            const { body: _body, ...summary } = readableEntry(entry);
            return summary;
          });
        return { count: pages.length, pages };
      },
    },
    {
      name: 'cms_read_site_page',
      description:
        'Read one CMS post or page before updating it, using its stable entry ID or its exact slug and collection.',
      parameters: {
        type: 'object',
        properties: {
          entry_id: { type: 'string' },
          slug: { type: 'string' },
          collection: { type: 'string', enum: ['posts', 'pages'] },
        },
        anyOf: [{ required: ['entry_id'] }, { required: ['slug', 'collection'] }],
      },
      handler: async (args) => {
        const values = args as { entry_id?: string; slug?: string; collection?: Collection };
        const entry = await readEntry(context, values);
        return readableEntry(entry);
      },
    },
    {
      name: 'cms_get_current_site_page',
      description:
        'Get the CMS source content and slug for the post or page currently displayed in the browser.',
      parameters: { type: 'object', properties: {} },
      handler: async () => {
        const reference = currentPageReference();
        const entry = await readEntry(context, reference);
        return { ...readableEntry(entry), current_url: window.location.href };
      },
    },
    {
      name: 'cms_update_site_page',
      description: 'Update an explicitly identified entry, optionally publishing it afterward.',
      parameters: {
        type: 'object',
        properties: {
          entry_id: { type: 'string' },
          existing_slug: { type: 'string' },
          collection: { type: 'string', enum: ['posts', 'pages'] },
          title: { type: 'string' },
          slug: { type: 'string' },
          excerpt: { type: 'string' },
          body: { type: 'string' },
          publish: { type: 'boolean' },
        },
        required: ['collection'],
        anyOf: [{ required: ['entry_id'] }, { required: ['existing_slug'] }],
      },
      handler: async (args) => {
        const values = args as {
          entry_id?: string;
          existing_slug?: string;
          collection: Collection;
          title?: string;
          slug?: string;
          excerpt?: string;
          body?: string;
          publish?: boolean;
        };
        const changes: Record<string, unknown> = {};
        for (const key of ['title', 'slug', 'excerpt', 'body'] as const) {
          if (values[key] !== undefined) changes[key] = values[key];
        }
        if (!Object.keys(changes).length) throw new Error('No content changes were provided.');
        const target = values.entry_id
          ? `/api/cms/sites/${context.siteId}/entries/${values.entry_id}`
          : `/api/cms/sites/${context.siteId}/entries/by-slug/${encodeURIComponent(values.existing_slug ?? '')}?collection=${values.collection}`;
        let entry = await cmsRequest<EntryResult>(context, target, {
          method: 'PATCH',
          body: JSON.stringify(changes),
        });
        if (values.publish) {
          entry = await cmsRequest<EntryResult>(
            context,
            `/api/cms/sites/${context.siteId}/entries/${entry.id}/publish`,
            { method: 'POST' },
          );
        }
        return result(
          entry,
          values.collection,
          values.publish ? 'Page updated and published.' : 'Page updated.',
        );
      },
    },
    {
      name: 'cms_publish_site_page',
      description:
        'Publish an existing post or standalone page identified by its entry ID or exact slug.',
      parameters: {
        type: 'object',
        properties: {
          entry_id: { type: 'string' },
          existing_slug: { type: 'string' },
          collection: { type: 'string', enum: ['posts', 'pages'] },
        },
        required: ['collection'],
        anyOf: [{ required: ['entry_id'] }, { required: ['existing_slug'] }],
      },
      handler: async (args) => {
        const values = args as {
          entry_id?: string;
          existing_slug?: string;
          collection: Collection;
        };
        const target = values.entry_id
          ? `/api/cms/sites/${context.siteId}/entries/${values.entry_id}/publish`
          : `/api/cms/sites/${context.siteId}/entries/by-slug/${encodeURIComponent(values.existing_slug ?? '')}/publish?collection=${values.collection}`;
        const entry = await cmsRequest<EntryResult>(context, target, { method: 'POST' });
        return result(entry, values.collection, 'Page published.');
      },
    },
    {
      name: 'cms_unpublish_site_page',
      description:
        'Unpublish an existing post or standalone page, returning it to draft status and removing it from the public website.',
      parameters: {
        type: 'object',
        properties: {
          entry_id: { type: 'string' },
          existing_slug: { type: 'string' },
          collection: { type: 'string', enum: ['posts', 'pages'] },
        },
        required: ['collection'],
        anyOf: [{ required: ['entry_id'] }, { required: ['existing_slug'] }],
      },
      handler: async (args) => {
        const values = args as {
          entry_id?: string;
          existing_slug?: string;
          collection: Collection;
        };
        const entryId = values.entry_id
          ? values.entry_id
          : (
              await readEntry(context, {
                slug: values.existing_slug,
                collection: values.collection,
              })
            ).id;
        const entry = await cmsRequest<EntryResult>(
          context,
          `/api/cms/sites/${context.siteId}/entries/${encodeURIComponent(entryId)}/unpublish`,
          { method: 'POST' },
        );
        return result(entry, values.collection, 'Page unpublished and returned to draft status.');
      },
    },
    {
      name: 'cms_delete_site_page',
      description:
        'Permanently delete an unpublished post or standalone page after explicit confirmation. Published pages must be unpublished first.',
      parameters: {
        type: 'object',
        properties: {
          entry_id: { type: 'string' },
          existing_slug: { type: 'string' },
          collection: { type: 'string', enum: ['posts', 'pages'] },
          confirm: {
            type: 'boolean',
            description: 'Must be true only after the user explicitly confirms permanent deletion.',
          },
        },
        required: ['collection', 'confirm'],
        anyOf: [{ required: ['entry_id'] }, { required: ['existing_slug'] }],
      },
      handler: async (args) => {
        const values = args as {
          entry_id?: string;
          existing_slug?: string;
          collection: Collection;
          confirm: boolean;
        };
        if (values.confirm !== true) {
          throw new Error('Explicit confirmation is required before deleting a page.');
        }
        const entry = await readEntry(context, {
          entry_id: values.entry_id,
          slug: values.existing_slug,
          collection: values.collection,
        });
        if (entry.status === 'published') {
          throw new Error('Published pages must be unpublished before deletion.');
        }
        await cmsRequest<void>(
          context,
          `/api/cms/sites/${context.siteId}/entries/${encodeURIComponent(entry.id)}`,
          { method: 'DELETE' },
        );
        return {
          id: entry.id,
          slug: entry.slug,
          collection: entry.collection,
          status: 'deleted',
          message: 'Page permanently deleted.',
        };
      },
    },
    {
      name: 'cms_show_site_page',
      description: 'Open a published post or standalone page in its rendered Astro website view.',
      parameters: {
        type: 'object',
        properties: {
          slug: { type: 'string' },
          collection: { type: 'string', enum: ['posts', 'pages'] },
        },
        required: ['slug', 'collection'],
      },
      handler: async (args) => {
        const values = args as { slug: string; collection: Collection };
        const publicUrl = `/${values.collection === 'posts' ? 'posts' : 'pages'}/${encodeURIComponent(values.slug)}`;
        const opened = window.open(publicUrl, '_blank', 'noopener,noreferrer') !== null;
        return {
          slug: values.slug,
          collection: values.collection,
          public_url: publicUrl,
          opened,
          message: opened
            ? 'Published page opened in a new tab.'
            : 'The browser blocked the new tab; use public_url to open the page.',
        };
      },
    },
    {
      name: 'cms_refresh_site_view',
      description:
        'Refresh the currently displayed Astro page in place after published content changes, preserving the open chat and browser tab.',
      parameters: { type: 'object', properties: {} },
      handler: refreshCurrentView,
    },
  ];
}
