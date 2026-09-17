/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

const reactor = globalThis.__DATALAYER_REACTOR__?.shared?.['@datalayer/reactor'];
if (!reactor) throw new Error('@cms-astro/core: Reactor is not shared by the host');

const { definePlugin, defineContributionPoint, contribution } = reactor;
const point = (name) => defineContributionPoint(`cmsAstro.${name}`);
const ContentTypes = point('contentType');
const Themes = point('theme');
const DashboardWidgets = point('dashboardWidget');
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
  ],
});
