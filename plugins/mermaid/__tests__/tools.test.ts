/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

import { describe, expect, it } from 'vitest';

import { agentToolBundle, buildReactorFromPlugins, configurePlugin } from '@datalayer/reactor';

import { mermaidToolDefinitions } from '../src/definitions';
import { createMermaidToolHandlers } from '../src/handlers';
import { createMemoryDiagramHost } from '../src/host';
import { mermaidToolOperations } from '../src/operations';
import { MermaidPlugin, type MermaidPluginConfig } from '../src/plugin';
import { MERMAID_AGENT_TOOLS, mermaidToolMismatches } from '../src/tools';

const engine = {
  parse: async () => true,
  render: async () => ({ svg: '<svg/>' }),
};

describe('the tools', () => {
  it('agree across definitions, operations and handlers', () => {
    expect(
      mermaidToolMismatches(createMermaidToolHandlers(createMemoryDiagramHost(), engine)),
    ).toEqual([]);
  });

  it('are six, named for the plugin, described at a length worth reading', () => {
    expect(mermaidToolDefinitions.map((d) => d.toolReferenceName)).toEqual([
      'mermaidSetDiagram',
      'mermaidReadDiagram',
      'mermaidListDiagrams',
      'mermaidValidate',
      'mermaidRenderSvg',
      'mermaidListDiagramTypes',
    ]);
    for (const definition of mermaidToolDefinitions) {
      expect(definition.name).toBe(`datalayer_${definition.toolReferenceName}`);
      expect(definition.description.length).toBeGreaterThan(80);
    }
  });

  it('describe what they take as JSON Schema', () => {
    const set = mermaidToolDefinitions[0].parameters;
    expect(set.required).toEqual(['source']);
    expect(Object.keys(set.properties).sort()).toEqual(['diagramId', 'source', 'title']);
    expect(mermaidToolDefinitions[5].parameters.properties).toEqual({});
  });

  it('refuse a call their schema refuses', async () => {
    await expect(
      mermaidToolOperations.mermaidReadDiagram.execute({}, {
        executor: { execute: async () => ({}) },
      }),
    ).rejects.toThrow(/diagramId/);
  });

  it('are offered to an agent as the commands of their operations', () => {
    expect(MERMAID_AGENT_TOOLS.toolset).toEqual(mermaidToolDefinitions.map((d) => d.name));
    expect(MERMAID_AGENT_TOOLS.commands[0].command).toBe('mermaid.mermaidSetDiagram');
  });
});

async function platformWith(config: Partial<MermaidPluginConfig>) {
  const reactor = buildReactorFromPlugins([configurePlugin(MermaidPlugin, config)]);
  reactor.start();
  await reactor.whenReady();
  return reactor;
}

describe('the plugin in a platform', () => {
  it('contributes its bundle and runs a tool against its host', async () => {
    const host = createMemoryDiagramHost();
    const reactor = await platformWith({ host, engine });
    expect(agentToolBundle(reactor, 'mermaid')?.commands).toHaveLength(6);
    const made: any = await reactor.executeCommand('mermaid.mermaidSetDiagram', { source: 'pie' });
    expect(host.get(made.diagramId)?.source).toBe('pie');
  });

  it('says so when it was given no host', async () => {
    const reactor = await platformWith({});
    await expect(reactor.executeCommand('mermaid.mermaidListDiagrams', {})).rejects.toThrow(
      /without a diagram host/,
    );
  });
});
