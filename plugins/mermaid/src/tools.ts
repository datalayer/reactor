/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * The Mermaid tools, as one thing a host can hand over: definitions,
 * operations, an executor over the handlers, and the reactor `AgentTools`
 * bundle.
 *
 * @module tools
 */

import { defineAgentTools } from '@datalayer/reactor';
import type { ToolDefinition, ToolExecutor, ToolOperation } from '@datalayer/reactor/tools';

import { mermaidToolDefinitions } from './definitions';
import type { MermaidToolHandler } from './handlers';
import { mermaidToolOperations } from './operations';

/** The plugin's short name: the tools bundle's id and the commands' namespace. */
export const MERMAID_TOOLS_NAME = 'mermaid';

export const mermaidTools: {
  name: string;
  definitions: ToolDefinition[];
  operations: Record<string, ToolOperation<unknown, unknown>>;
} = {
  name: MERMAID_TOOLS_NAME,
  definitions: mermaidToolDefinitions,
  operations: mermaidToolOperations,
};

/** The reactor command a tool's operation runs as: `mermaid.mermaidSetDiagram`. */
export const mermaidCommandOf = (operation: string): string => `${MERMAID_TOOLS_NAME}.${operation}`;

/** The executor the operations hand their validated calls to. */
export function createMermaidExecutor(handlers: Record<string, MermaidToolHandler>): ToolExecutor {
  return {
    execute: async (operationName, args) => {
      const handler = handlers[operationName];
      if (!handler) {
        throw new Error(`No Mermaid handler for '${operationName}'.`);
      }
      return handler((args ?? {}) as Record<string, unknown>);
    },
  };
}

/** The tools as a reactor `AgentTools` bundle. */
export const MERMAID_AGENT_TOOLS = defineAgentTools({
  id: MERMAID_TOOLS_NAME,
  name: 'Mermaid',
  description:
    "Write Mermaid diagrams and show them: create or replace a diagram's source, read it back, check it with Mermaid's parser, render it to SVG, and list the diagram types.",
  plugin: '@datalayer/reactor-mermaid',
  commands: mermaidToolDefinitions.map((definition) => ({
    name: definition.name,
    command: mermaidCommandOf(definition.operation),
    description: definition.description,
    parameters: definition.parameters,
  })),
});

/** The operation names the three halves disagree about, if any. */
export function mermaidToolMismatches(handlers: Record<string, MermaidToolHandler>): string[] {
  const problems: string[] = [];
  for (const definition of mermaidToolDefinitions) {
    if (!mermaidToolOperations[definition.operation]) {
      problems.push(`${definition.name} points at operation '${definition.operation}', which does not exist`);
    }
    if (!definition.toolReferenceName.startsWith('mermaid')) {
      problems.push(`${definition.name} is not named for the plugin it belongs to`);
    }
  }
  for (const name of Object.keys(mermaidToolOperations)) {
    if (!handlers[name]) {
      problems.push(`operation '${name}' has no handler`);
    }
  }
  for (const name of Object.keys(handlers)) {
    if (!mermaidToolOperations[name]) {
      problems.push(`handler '${name}' has no operation`);
    }
  }
  return problems;
}
