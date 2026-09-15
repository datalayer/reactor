/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

const reactor = globalThis.__DATALAYER_REACTOR__?.shared?.['@datalayer/reactor'];
if (!reactor) throw new Error('@cms-astro/pro: Reactor is not shared by the host');

const { definePlugin, defineContributionPoint, contribution } = reactor;
const point = (name) => defineContributionPoint(`cmsAstro.${name}`);
const EditorActions = point('editorAction');
const Themes = point('theme');
const DashboardWidgets = point('dashboardWidget');

export default definePlugin({
  name: '@cms-astro/pro',
  version: '0.1.0',
  requiredBackendPlugins: ['cms-astro.pro'],
  contributes: [
    contribution(EditorActions, { label: 'Analyze SEO', backendAction: 'analyze' }, { id: 'seo' }),
    contribution(EditorActions, { label: 'Schedule publication' }, { id: 'schedule', order: 10 }),
    contribution(Themes, { slug: 'midnight', label: 'Midnight Pro', tokens: { accent: '#8b5cf6' } }, { id: 'midnight', order: 100 }),
    contribution(DashboardWidgets, { label: 'Editorial audit log' }, { id: 'audit', order: 100 }),
  ],
});
