/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AgentTools, contribution, defineAgentTools, definePlugin } from '@datalayer/reactor';
import type { CmsSiteSession } from './tools';

const AgentRuntime = lazy(() => import('./AgentRuntime'));
const crawlParameters = {
  type: 'object',
  properties: {
    url: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 50 },
  },
  required: ['url'],
};

const tools = defineAgentTools({
  id: 'cms-astro-ai-agents',
  version: '0.1.0',
  name: 'Astro CMS AI Agents',
  description: 'Import public blogs and create or update content in the authenticated site.',
  plugin: '@cms-astro/ai-agents',
  commands: [
    {
      name: 'cms_crawl_blog',
      command: 'cmsAstroAi.crawlBlog',
      description: 'Crawl pages linked from a public blog index.',
      parameters: crawlParameters,
    },
    {
      name: 'cms_crawl_wordpress',
      command: 'cmsAstroAi.crawlWordpress',
      description: 'Discover and read posts from a public WordPress REST API.',
      parameters: crawlParameters,
    },
    {
      name: 'cms_create_site_page',
      command: 'cmsAstroAi.createSitePage',
      description: 'Create a draft or published post or page in the current site.',
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
    },
    {
      name: 'cms_update_site_page',
      command: 'cmsAstroAi.updateSitePage',
      description: 'Update an explicitly identified entry in the current site.',
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
    },
  ],
});

const plugin = definePlugin({
  name: '@cms-astro/ai-agents',
  version: '0.1.0',
  displayName: 'CMS AI Agents',
  description: 'Authenticated AI-assisted blog import and content authoring.',
  emoji: '✍️',
  requiredBackendPlugins: ['cms-astro.ai-agents', 'cms-astro.core'],
  contributes: [contribution(AgentTools, tools, { id: 'cms-astro-ai-agents' })],
});

type MountOptions = {
  apiUrl: string;
  siteId: string;
  siteName: string;
  element: HTMLElement;
};

function storedSession(): CmsSiteSession | undefined {
  try {
    return JSON.parse(sessionStorage.getItem('cms-session') ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
}

function PublicSiteAgent({ apiUrl, siteId, siteName }: Omit<MountOptions, 'element'>) {
  const [session, setSession] = useState<CmsSiteSession>();
  useEffect(() => {
    let cancelled = false;
    const validate = async () => {
      const candidate = storedSession();
      if (!candidate?.token) return setSession(undefined);
      try {
        const response = await fetch(`${apiUrl}/api/cms/session`, {
          headers: { Authorization: `Bearer ${candidate.token}` },
        });
        if (!response.ok) throw new Error('invalid CMS session');
        const identity = (await response.json()) as Omit<CmsSiteSession, 'token'>;
        if (!identity.memberships.some(item => item.site_id === siteId)) {
          throw new Error('no access to this site');
        }
        if (!cancelled) setSession({ token: candidate.token, ...identity });
      } catch {
        if (!cancelled) setSession(undefined);
      }
    };
    void validate();
    window.addEventListener('storage', validate);
    return () => {
      cancelled = true;
      window.removeEventListener('storage', validate);
    };
  }, [apiUrl, siteId]);
  if (!session) return null;
  return (
    <Suspense fallback={null}>
      <AgentRuntime apiUrl={apiUrl} siteId={siteId} siteName={siteName} session={session} />
    </Suspense>
  );
}

const mounted = new WeakMap<HTMLElement, Root>();

/** Public-site hook consumed by CMS Core's generic extension host. */
export function mountPublicSiteExtension({ apiUrl, siteId, siteName, element }: MountOptions) {
  mounted.get(element)?.unmount();
  const root = createRoot(element);
  mounted.set(element, root);
  root.render(<PublicSiteAgent apiUrl={apiUrl} siteId={siteId} siteName={siteName} />);
  return () => {
    if (mounted.get(element) === root) mounted.delete(element);
    root.unmount();
  };
}

export default plugin;
