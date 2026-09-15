const shared = globalThis.__DATALAYER_REACTOR__?.shared;
if (!shared) throw new Error('@cms-astro/x402: host shared modules are unavailable');
const { definePlugin, defineContributionPoint, contribution } = shared['@datalayer/reactor'];
const EditorActions = defineContributionPoint('cmsAstro.editorAction');
const DashboardWidgets = defineContributionPoint('cmsAstro.dashboardWidget');

export default definePlugin({
  name: '@cms-astro/x402',
  version: '0.1.0',
  requiredBackendPlugins: ['cms-astro.x402'],
  contributes: [
    contribution(EditorActions, {
      id: 'x402', label: 'Configure paid access', backendPlugin: 'cms-astro.x402', backendAction: 'requirements',
      fields: [{ name: 'price', label: 'Price', type: 'number' }, { name: 'network', label: 'CAIP-2 network', type: 'text' }],
    }, { id: 'x402', order: 200 }),
    contribution(DashboardWidgets, {
      id: 'x402-status', label: 'x402 payments', description: 'Payment requirements and settlement status',
    }, { id: 'x402-status', order: 200 }),
  ],
});
