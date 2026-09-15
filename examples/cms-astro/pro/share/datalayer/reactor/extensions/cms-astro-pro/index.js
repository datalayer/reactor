const shared = globalThis.__DATALAYER_REACTOR__?.shared;
if (!shared) throw new Error('@cms-astro/pro: host shared modules are unavailable');
const { definePlugin, defineContributionPoint, contribution } = shared['@datalayer/reactor'];
const EditorActions = defineContributionPoint('cmsAstro.editorAction');
const Themes = defineContributionPoint('cmsAstro.theme');
const DashboardWidgets = defineContributionPoint('cmsAstro.dashboardWidget');

export default definePlugin({
  name: '@cms-astro/pro', version: '0.1.0', requiredBackendPlugins: ['cms-astro.pro'],
  contributes: [
    contribution(EditorActions, { id: 'seo', label: 'Analyze SEO', backendAction: 'analyze' }, { id: 'seo' }),
    contribution(EditorActions, { id: 'schedule', label: 'Schedule publication' }, { id: 'schedule', order: 10 }),
    contribution(Themes, { slug: 'midnight', label: 'Midnight Pro', tokens: { accent: '#8b5cf6' } }, { id: 'midnight', order: 100 }),
    contribution(DashboardWidgets, { id: 'audit', label: 'Editorial audit log' }, { id: 'audit', order: 100 }),
  ],
});
