/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

const reactor = globalThis.__DATALAYER_REACTOR__?.shared?.['@datalayer/reactor'];
if (!reactor) throw new Error('@cms-astro/core: Reactor is not shared by the host');

const { AgentTools, defineAgentTools, definePlugin, defineContributionPoint, contribution } = reactor;
const point = (name) => defineContributionPoint(`cmsAstro.${name}`);
const ContentTypes = point('contentType');
const Themes = point('theme');
const DashboardWidgets = point('dashboardWidget');
const CmsAgentTools = defineAgentTools({
  id: 'cms-astro',
  version: '0.1.0',
  name: 'Astro CMS',
  description: 'Import public blogs and create or update content in the authenticated site.',
  plugin: '@cms-astro/core',
  commands: [
    {
      name: 'cms_crawl_blog',
      command: 'cmsAstro.crawlBlog',
      description: 'Crawl pages linked from a public blog index.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } },
        required: ['url'],
      },
    },
    {
      name: 'cms_crawl_wordpress',
      command: 'cmsAstro.crawlWordpress',
      description: 'Discover and read posts from a public WordPress REST API.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 50 } },
        required: ['url'],
      },
    },
    {
      name: 'cms_create_site_page',
      command: 'cmsAstro.createSitePage',
      description: 'Create a draft or published post or page in the current site.',
      parameters: {
        type: 'object',
        properties: {
          collection: { type: 'string', enum: ['posts', 'pages'] },
          title: { type: 'string' }, slug: { type: 'string' }, excerpt: { type: 'string' },
          body: { type: 'string' }, source_url: { type: 'string' }, publish: { type: 'boolean' },
        },
        required: ['collection', 'title', 'body'],
      },
    },
    {
      name: 'cms_update_site_page',
      command: 'cmsAstro.updateSitePage',
      description: 'Update an explicitly identified entry in the current site.',
      parameters: {
        type: 'object',
        properties: {
          entry_id: { type: 'string' }, existing_slug: { type: 'string' },
          collection: { type: 'string', enum: ['posts', 'pages'] }, title: { type: 'string' }, slug: { type: 'string' },
          excerpt: { type: 'string' }, body: { type: 'string' },
          publish: { type: 'boolean' },
        },
        required: ['collection'],
        anyOf: [{ required: ['entry_id'] }, { required: ['existing_slug'] }],
      },
    },
  ],
});

export default definePlugin({
  name: '@cms-astro/core',
  version: '0.1.0',
  requiredBackendPlugins: ['cms-astro.core'],
  contributes: [
    contribution(ContentTypes, { slug: 'posts', label: 'Posts', icon: 'file-text' }, { id: 'posts' }),
    contribution(ContentTypes, { slug: 'pages', label: 'Pages', icon: 'files' }, { id: 'pages' }),
    contribution(Themes, { slug: 'editorial', label: 'Editorial' }, { id: 'editorial' }),
    contribution(Themes, { slug: 'studio', label: 'Studio' }, { id: 'studio' }),
    contribution(DashboardWidgets, { label: 'Quick draft', endpoint: '/api/cms/sites/{site}/entries' }, { id: 'quick-draft' }),
    contribution(AgentTools, CmsAgentTools, { id: 'cms-astro' }),
  ],
});
