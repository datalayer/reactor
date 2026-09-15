const reactor = globalThis.__DATALAYER_REACTOR__?.shared?.['@datalayer/reactor'];
if (!reactor) throw new Error('@cms-astro/x402: Reactor is not shared by the host');

const { definePlugin, defineContributionPoint, contribution } = reactor;
const point = (name) => defineContributionPoint(`cmsAstro.${name}`);
const EditorActions = point('editorAction');
const DashboardWidgets = point('dashboardWidget');

export default definePlugin({
  name: '@cms-astro/x402',
  version: '0.1.0',
  requiredBackendPlugins: ['cms-astro.x402'],
  contributes: [
    contribution(EditorActions, {
      label: 'Configure paid access', backendPlugin: 'cms-astro.x402', backendAction: 'requirements',
      fields: [{ name: 'price', label: 'Price', type: 'number' }, { name: 'network', label: 'CAIP-2 network', type: 'text' }],
    }, { id: 'x402', order: 200 }),
    contribution(DashboardWidgets, {
      label: 'x402 payments', description: 'Payment requirements and settlement status',
    }, { id: 'x402-status', order: 200 }),
  ],
});
