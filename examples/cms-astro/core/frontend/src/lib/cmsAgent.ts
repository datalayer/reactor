/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import type { FrontendToolDefinition } from '@datalayer/agent-runtimes/lib/types/tools';

type CmsSession = { token: string; user: { id: string } };
type CmsEntryResult = {
  id: string;
  collection: 'posts' | 'pages';
  slug: string;
  status: string;
};
type ToolContext = {
  apiUrl: string;
  siteId: string;
  session: CmsSession;
};

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
      const payload = (await response.json()) as { detail?: string };
      message = payload.detail ?? message;
    } catch {
      // Preserve the HTTP fallback when the server did not return JSON.
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function publicPath(collection: string, slug: string): string {
  return `/${collection === 'posts' ? 'posts' : 'pages'}/${slug}`;
}

function safeWriteResult(
  entry: CmsEntryResult,
  collection: 'posts' | 'pages',
  message: string,
) {
  return {
    id: entry.id,
    slug: entry.slug,
    status: entry.status,
    public_url: publicPath(collection, entry.slug),
    message,
  };
}

function crawlTool(
  context: ToolContext,
  kind: 'blog' | 'wordpress',
): FrontendToolDefinition {
  return {
    name: kind === 'blog' ? 'cms_crawl_blog' : 'cms_crawl_wordpress',
    description:
      kind === 'blog'
        ? 'Crawl content pages linked from a public blog index without changing the CMS.'
        : 'Discover a public WordPress REST API and return its latest rendered posts without changing the CMS.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Public http or https blog URL.' },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: 'Maximum pages to return. Defaults to 12.',
        },
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
      description:
        'Create a post or standalone page in the current site. It remains a draft unless publish is true.',
      parameters: {
        type: 'object',
        properties: {
          collection: { type: 'string', enum: ['posts', 'pages'] },
          title: { type: 'string' },
          slug: { type: 'string', description: 'Optional URL-safe slug.' },
          excerpt: { type: 'string' },
          body: { type: 'string', description: 'Complete content as readable plain text or Markdown.' },
          source_url: { type: 'string', description: 'Original public URL for imported content.' },
          publish: { type: 'boolean', description: 'Publish immediately. Defaults to false.' },
        },
        required: ['collection', 'title', 'body'],
      },
      handler: async args => {
        const values = args as {
          collection: 'posts' | 'pages';
          title: string;
          slug?: string;
          excerpt?: string;
          body: string;
          source_url?: string;
          publish?: boolean;
        };
        let entry = await cmsRequest<CmsEntryResult>(
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
          entry = await cmsRequest<CmsEntryResult>(
            context,
            `/api/cms/sites/${context.siteId}/entries/${entry.id}/publish`,
            { method: 'POST' },
          );
        }
        return safeWriteResult(
          entry,
          values.collection,
          values.publish ? 'Page created and published.' : 'Draft page created.',
        );
      },
    },
    {
      name: 'cms_update_site_page',
      description:
        'Update the explicitly identified entry in the current site, optionally publishing it afterward.',
      parameters: {
        type: 'object',
        properties: {
          entry_id: { type: 'string', description: 'Exact CMS entry id supplied by the person.' },
          existing_slug: { type: 'string', description: 'Exact current slug, used when entry_id is omitted.' },
          collection: { type: 'string', enum: ['posts', 'pages'] },
          title: { type: 'string' },
          slug: { type: 'string' },
          excerpt: { type: 'string' },
          body: { type: 'string' },
          publish: { type: 'boolean', description: 'Publish after updating. Defaults to false.' },
        },
        required: ['collection'],
        anyOf: [{ required: ['entry_id'] }, { required: ['existing_slug'] }],
      },
      handler: async args => {
        const values = args as {
          entry_id?: string;
          existing_slug?: string;
          collection: 'posts' | 'pages';
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
          : `/api/cms/sites/${context.siteId}/entries/by-slug/${encodeURIComponent(values.existing_slug ?? '')}`;
        let entry = await cmsRequest<CmsEntryResult>(
          context,
          target,
          { method: 'PATCH', body: JSON.stringify(changes) },
        );
        if (values.publish) {
          entry = await cmsRequest<CmsEntryResult>(
            context,
            `/api/cms/sites/${context.siteId}/entries/${entry.id}/publish`,
            { method: 'POST' },
          );
        }
        return safeWriteResult(
          entry,
          values.collection,
          values.publish ? 'Page updated and published.' : 'Page updated.',
        );
      },
    },
  ];
}
