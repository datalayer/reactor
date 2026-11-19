/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * The reactor plugin: the Mermaid tools as commands, `mermaid.<operation>`,
 * run against the host and engine it was configured with, and the
 * `AgentTools` bundle that offers them to an agent.
 *
 * ```ts
 * import mermaid from 'mermaid';
 * configurePlugin(MermaidPlugin, { host: createMemoryDiagramHost(), engine: mermaid });
 * ```
 *
 * @module plugin
 */

import { AgentTools, contribution, definePlugin } from '@datalayer/reactor';

import { mermaidToolDefinitions } from './definitions';
import { createMermaidToolHandlers } from './handlers';
import type { MermaidDiagramHost, MermaidEngine } from './host';
import { mermaidToolOperations } from './operations';
import { createMermaidExecutor, MERMAID_AGENT_TOOLS, MERMAID_TOOLS_NAME, mermaidCommandOf } from './tools';

export const MERMAID_PLUGIN_NAME = '@datalayer/reactor-mermaid';

export type MermaidPluginConfig = {
  /** What keeps the diagrams. Without one, every command says so. */
  host: MermaidDiagramHost | null;
  /** Mermaid itself. Without it, every command says so. */
  engine: MermaidEngine | null;
};

export const MermaidPlugin = definePlugin<MermaidPluginConfig>({
  name: MERMAID_PLUGIN_NAME,
  displayName: 'Mermaid',
  description: 'Mermaid diagrams as tools an agent writes, checks and renders.',
  octicon: 'workflow',
  emoji: '\u{1F9DC}',
  config: { host: null, engine: null },
  contributes: [contribution(AgentTools, MERMAID_AGENT_TOOLS, { id: MERMAID_TOOLS_NAME })],
  register: ({ config, registerCommand }) => {
    const { host, engine } = config;
    const executor = host && engine ? createMermaidExecutor(createMermaidToolHandlers(host, engine)) : null;
    const undo = mermaidToolDefinitions.map((definition) =>
      registerCommand<Record<string, unknown> | undefined, unknown>({
        id: mermaidCommandOf(definition.operation),
        name: definition.displayName,
        description: definition.description,
        category: 'Mermaid',
        execute: (argument) => {
          if (!executor) {
            throw new Error(`${MERMAID_PLUGIN_NAME} was configured without a diagram host and engine.`);
          }
          return mermaidToolOperations[definition.operation].execute(argument ?? {}, {
            executor,
            documentId: MERMAID_TOOLS_NAME,
          });
        },
      }),
    );
    return () => {
      for (const dispose of undo) {
        dispose();
      }
    };
  },
});
