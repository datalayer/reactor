/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import { lazy, Suspense, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AgentTools, contribution, defineAgentTools, definePlugin } from '@datalayer/reactor';
import { coreStore } from '@datalayer/agent-runtimes/lib/state/index.js';
import type { CmsSiteSession } from './tools';

const AgentRuntime = lazy(() => import('./AgentRuntime'));
const cmsAuthChannel = 'cms-astro-auth';
const stylesheetMarker = 'data-cms-astro-ai-agents-styles';
const defaultInferenceUrl = 'https://r1.datalayer.run';
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
    {
      name: 'cms_publish_site_page',
      command: 'cmsAstroAi.publishSitePage',
      description: 'Publish an existing post or page identified by its entry ID or exact slug.',
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
    },
    {
      name: 'cms_show_site_page',
      command: 'cmsAstroAi.showSitePage',
      description: 'Open a published post or page in its rendered Astro website view.',
      parameters: {
        type: 'object',
        properties: {
          slug: { type: 'string' },
          collection: { type: 'string', enum: ['posts', 'pages'] },
        },
        required: ['slug', 'collection'],
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
  inferenceUrl?: string;
};

function configureInference(inferenceUrl?: string) {
  const buildUrl = (
    import.meta as ImportMeta & {
      env?: { VITE_DATALAYER_AI_INFERENCE_URL?: string };
    }
  ).env?.VITE_DATALAYER_AI_INFERENCE_URL;
  coreStore.getState().setConfiguration({
    aiInferenceUrl: inferenceUrl || buildUrl || defaultInferenceUrl,
  });
}

function storedSession(): CmsSiteSession | undefined {
  try {
    return JSON.parse(sessionStorage.getItem('cms-session') ?? 'null') ?? undefined;
  } catch {
    return undefined;
  }
}

function ensureStylesheet() {
  if (document.querySelector(`link[${stylesheetMarker}]`)) return;
  const stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = new URL('./cms-astro-ai-agents.css', import.meta.url).href;
  stylesheet.setAttribute(stylesheetMarker, '');
  document.head.append(stylesheet);
}

function AgentLauncherButton({
  label,
  disabled = false,
  onClick,
  children = '✦',
}: {
  label: string;
  disabled?: boolean;
  onClick?: () => void;
  children?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      style={{
        position: 'fixed',
        right: 20,
        bottom: 20,
        zIndex: 1001,
        width: 56,
        height: 56,
        border: 0,
        borderRadius: '50%',
        color: 'var(--fgColor-onEmphasis, #fff)',
        background: 'var(--bgColor-accent-emphasis, #0969da)',
        boxShadow: '0 8px 24px rgb(0 0 0 / 20%)',
        fontSize: 22,
      }}
    >
      {children}
    </button>
  );
}

function AgentLauncherFallback() {
  return <AgentLauncherButton label="Loading the AI authoring assistant" disabled />;
}

function PublicSiteAgent({ apiUrl, siteId, siteName }: Omit<MountOptions, 'element'>) {
  const [session, setSession] = useState<CmsSiteSession>();
  const [sessionChecked, setSessionChecked] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const validate = async (provided?: CmsSiteSession) => {
      const candidate = provided ?? storedSession();
      if (!candidate?.token) {
        setSession(undefined);
        setSessionChecked(true);
        return;
      }
      try {
        const response = await fetch(`${apiUrl}/api/cms/session`, {
          headers: { Authorization: `Bearer ${candidate.token}` },
        });
        if (!response.ok) throw new Error('invalid CMS session');
        const identity = (await response.json()) as Omit<CmsSiteSession, 'token'>;
        if (!identity.memberships.some((item) => item.site_id === siteId)) {
          throw new Error('no access to this site');
        }
        if (!cancelled) {
          const validated = { token: candidate.token, ...identity };
          sessionStorage.setItem('cms-session', JSON.stringify(validated));
          setSession(validated);
          setSessionChecked(true);
        }
      } catch {
        if (!cancelled) {
          setSession(undefined);
          setSessionChecked(true);
        }
      }
    };
    void validate();
    const handleStorage = () => void validate();
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin || event.data?.type !== 'session') return;
      void validate(event.data.session as CmsSiteSession);
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener('message', handleMessage);
    const channel =
      typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel(cmsAuthChannel);
    if (channel) {
      channel.onmessage = (event) => {
        if (event.data?.type === 'session') void validate(event.data.session as CmsSiteSession);
        if (event.data?.type === 'session-cleared' && !cancelled) setSession(undefined);
      };
      channel.postMessage({ type: 'request-session' });
    }
    window.opener?.postMessage({ type: 'request-session' }, window.location.origin);
    return () => {
      cancelled = true;
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('message', handleMessage);
      channel?.close();
    };
  }, [apiUrl, siteId]);
  if (!sessionChecked) return <AgentLauncherFallback />;
  return (
    <Suspense fallback={<AgentLauncherFallback />}>
      <AgentRuntime apiUrl={apiUrl} siteId={siteId} siteName={siteName} session={session} />
    </Suspense>
  );
}

const mounted = new WeakMap<HTMLElement, Root>();

/** Public-site hook consumed by CMS Core's generic extension host. */
export function mountPublicSiteExtension({
  apiUrl,
  siteId,
  siteName,
  element,
  inferenceUrl,
}: MountOptions) {
  ensureStylesheet();
  configureInference(inferenceUrl);
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
