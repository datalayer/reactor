/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 * BSD 3-Clause License
 */

/*
 * Copyright (c) 2021-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * The plugin in a platform: its tools are the commands of their operations,
 * offered to an agent through the reactor's `AgentTools` point, and run
 * against the host it was configured with.
 */

import { describe, expect, it } from 'vitest';

import { agentToolBundle, buildReactorFromPlugins, configurePlugin } from '@datalayer/reactor';

import { createMemoryDrawingHost } from '../src/host';
import { ExcalidrawPlugin, type ExcalidrawPluginConfig } from '../src/plugin';

const converters = { convertToExcalidrawElements: (skeletons: Record<string, any>[]) => skeletons };

async function platformWith(config: Partial<ExcalidrawPluginConfig>) {
  const reactor = buildReactorFromPlugins([configurePlugin(ExcalidrawPlugin, config)]);
  reactor.start();
  await reactor.whenReady();
  return reactor;
}

describe('the plugin in a platform', () => {
  it('offers its tools to an agent', async () => {
    const reactor = await platformWith({});
    const bundle = agentToolBundle(reactor, 'excalidraw');
    expect(bundle?.toolset).toContain('datalayer_excalidrawInsertNode');
    expect(bundle?.commands).toHaveLength(11);
  });

  it('runs a tool against the host it was given', async () => {
    const host = createMemoryDrawingHost();
    const reactor = await platformWith({ host, converters });
    const made: any = await reactor.executeCommand('excalidraw.excalidrawInsertNode', {
      afterId: 'BOTTOM',
      elements: [{ id: 'box', type: 'rectangle', x: 0, y: 0 }],
    });
    expect(host.get(made.blockId)?.scene.elements.map((e) => e.id)).toEqual(['box']);
  });

  it('refuses a call its schema refuses', async () => {
    const reactor = await platformWith({ host: createMemoryDrawingHost(), converters });
    await expect(
      reactor.executeCommand('excalidraw.excalidrawReadScene', {}),
    ).rejects.toThrow(/blockId/);
  });

  it('says so when it was given no host', async () => {
    const reactor = await platformWith({});
    await expect(
      reactor.executeCommand('excalidraw.excalidrawListDrawings', {}),
    ).rejects.toThrow(/without a drawing host/);
  });
});
