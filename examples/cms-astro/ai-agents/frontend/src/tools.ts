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

async function cmsRequest<T>(context: ToolContext, path: string, init: RequestInit = {}): Promise<T> {
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

function crawlTool(context: ToolContext, kind: 'blog' | 'wordpress'): FrontendToolDefinition {
  return {
    name: kind === 'blog' ? 'cms_crawl_blog' : 'cms_crawl_wordpress',
    description:
      kind === 'blog'
        ? 'Crawl content pages linked from a public blog index without changing the CMS.'
        : 'Discover a public WordPress REST API and return its latest posts without changing the CMS.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Public http or https blog URL.' },
        limit: { type: 'integer', minimum: 1, maximum: 50 },
      },
      required: ['url'],
    },
    handler: args => {
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
      handler: async args => {
        const values = args as {
          collection: Collection;
          title: string;
          slug?: string;
          excerpt?: string;
          body: string;
          source_url?: string;
          publish?: boolean;
        };
        let entry = await cmsRequest<EntryResult>(context, `/api/cms/sites/${context.siteId}/entries`, {
          method: 'POST',
          body: JSON.stringify({
            collection: values.collection,
            title: values.title,
            slug: values.slug,
            excerpt: values.excerpt ?? '',
            body: values.body,
            data: values.source_url ? { source_url: values.source_url } : {},
          }),
        });
        if (values.publish) {
          entry = await cmsRequest<EntryResult>(
            context,
            `/api/cms/sites/${context.siteId}/entries/${entry.id}/publish`,
            { method: 'POST' },
          );
        }
        return result(entry, values.collection, values.publish ? 'Page created and published.' : 'Draft page created.');
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
      handler: async args => {
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
        return result(entry, values.collection, values.publish ? 'Page updated and published.' : 'Page updated.');
      },
    },
    {
      name: 'cms_publish_site_page',
      description: 'Publish an existing post or standalone page identified by its entry ID or exact slug.',
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
      handler: async args => {
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
      handler: async args => {
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
  ];
}
