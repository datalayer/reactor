const shared = globalThis.__DATALAYER_REACTOR__?.shared;
if (!shared) throw new Error('@cms-astro/core: host shared modules are unavailable');
const { definePlugin, defineContributionPoint, contribution } = shared['@datalayer/reactor'];
const ContentTypes = defineContributionPoint('cmsAstro.contentType');
const Themes = defineContributionPoint('cmsAstro.theme');
const DashboardWidgets = defineContributionPoint('cmsAstro.dashboardWidget');

export default definePlugin({
  name: '@cms-astro/core', version: '0.1.0', requiredBackendPlugins: ['cms-astro.core'],
  contributes: [
    contribution(ContentTypes, { slug: 'posts', label: 'Posts', icon: 'file-text' }, { id: 'posts' }),
    contribution(ContentTypes, { slug: 'pages', label: 'Pages', icon: 'files' }, { id: 'pages' }),
    contribution(Themes, { slug: 'editorial', label: 'Editorial' }, { id: 'editorial' }),
    contribution(Themes, { slug: 'studio', label: 'Studio' }, { id: 'studio' }),
    contribution(DashboardWidgets, { id: 'quick-draft', label: 'Quick draft', endpoint: '/api/cms/sites/{site}/entries' }, { id: 'quick-draft' }),
  ],
});
