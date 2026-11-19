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
 * The reactor plugin: the Excalidraw tools as commands, and the bundle that
 * offers them to an agent.
 *
 * Each tool's operation is registered as a command, `excalidraw.<operation>`,
 * which validates its argument and runs it against the host the plugin was
 * configured with; the plugin's `AgentTools` bundle names those commands, so
 * a host that mounts the plugin hands an agent the tools without declaring
 * any.
 *
 * ```ts
 * configurePlugin(ExcalidrawPlugin, {
 *   host: createMemoryDrawingHost(),
 *   converters: { convertToExcalidrawElements, parseMermaidToExcalidraw },
 * });
 * ```
 *
 * @module plugin
 */

import { AgentTools, contribution, definePlugin } from '@datalayer/reactor';

import { excalidrawToolDefinitions } from './definitions';
import { createExcalidrawToolHandlers } from './handlers';
import type { ExcalidrawConverters, ExcalidrawDrawingHost } from './host';
import { excalidrawToolOperations } from './operations';
import {
  createExcalidrawExecutor,
  EXCALIDRAW_AGENT_TOOLS,
  EXCALIDRAW_TOOLS_NAME,
  excalidrawCommandOf,
} from './tools';

export const EXCALIDRAW_PLUGIN_NAME = '@datalayer/reactor-excalidraw';

export type ExcalidrawPluginConfig = {
  /** What keeps the drawings. Without one, every command says so. */
  host: ExcalidrawDrawingHost | null;
  /** Excalidraw's conversions. Without them, every command says so. */
  converters: ExcalidrawConverters | null;
};

export const ExcalidrawPlugin = definePlugin<ExcalidrawPluginConfig>({
  name: EXCALIDRAW_PLUGIN_NAME,
  displayName: 'Excalidraw',
  description: 'Excalidraw drawings as tools an agent draws with.',
  octicon: 'paintbrush',
  emoji: '\u{1F58C}\u{FE0F}',
  config: { host: null, converters: null },
  contributes: [contribution(AgentTools, EXCALIDRAW_AGENT_TOOLS, { id: EXCALIDRAW_TOOLS_NAME })],
  register: ({ config, registerCommand }) => {
    const { host, converters } = config;
    const executor =
      host && converters
        ? createExcalidrawExecutor(createExcalidrawToolHandlers(host, converters))
        : null;
    const undo = excalidrawToolDefinitions.map((definition) =>
      registerCommand<Record<string, unknown> | undefined, unknown>({
        id: excalidrawCommandOf(definition.operation),
        name: definition.displayName,
        description: definition.description,
        category: 'Excalidraw',
        execute: (argument) => {
          if (!executor) {
            throw new Error(
              `${EXCALIDRAW_PLUGIN_NAME} was configured without a drawing host and converters.`,
            );
          }
          return excalidrawToolOperations[definition.operation].execute(argument ?? {}, {
            executor,
            documentId: EXCALIDRAW_TOOLS_NAME,
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
