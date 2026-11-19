/*
 * Copyright (c) 2021-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * The Excalidraw tools, as one thing a host can hand over.
 *
 * Definitions, operations and handlers travel together because they are three
 * views of the same eleven tools, and a set that has drifted — a definition
 * pointing at an operation nobody wrote, a handler nobody advertises — is a
 * tool that fails at call time rather than at build time. Keeping them
 * adjacent is what {@link excalidrawToolMismatches} is able to exploit.
 *
 * @module tools
 */

import { defineAgentTools } from '@datalayer/reactor';
import type { ToolDefinition, ToolExecutor, ToolOperation } from '@datalayer/reactor/tools';

import { excalidrawToolDefinitions } from './definitions';
import type { ExcalidrawToolHandler } from './handlers';
import { excalidrawToolOperations } from './operations';

/** The plugin's short name: the tools bundle's id and the commands' namespace. */
export const EXCALIDRAW_TOOLS_NAME = 'excalidraw';

/** What a host registers with an agent: what exists, and what runs it. */
export const excalidrawTools: {
  name: string;
  definitions: ToolDefinition[];
  operations: Record<string, ToolOperation<unknown, unknown>>;
} = {
  name: EXCALIDRAW_TOOLS_NAME,
  definitions: excalidrawToolDefinitions,
  operations: excalidrawToolOperations,
};

/** The reactor command a tool's operation runs as: `excalidraw.excalidrawReadScene`. */
export const excalidrawCommandOf = (operation: string): string =>
  `${EXCALIDRAW_TOOLS_NAME}.${operation}`;

/**
 * The executor the operations hand their validated calls to, over a set of
 * handlers. Refuses an operation it has no handler for.
 */
export function createExcalidrawExecutor(
  handlers: Record<string, ExcalidrawToolHandler>,
): ToolExecutor {
  return {
    execute: async (operationName, args) => {
      const handler = handlers[operationName];
      if (!handler) {
        throw new Error(`No Excalidraw handler for '${operationName}'.`);
      }
      return handler((args ?? {}) as Record<string, unknown>);
    },
  };
}

/**
 * The tools as a reactor `AgentTools` bundle: each tool is the plugin's
 * command of its operation, with the tool's name, description and
 * parameters.
 */
export const EXCALIDRAW_AGENT_TOOLS = defineAgentTools({
  id: EXCALIDRAW_TOOLS_NAME,
  name: 'Excalidraw',
  description:
    'Draw diagrams in Excalidraw: insert a drawing, read it, add, change, connect and delete its shapes, and turn Mermaid source into shapes.',
  plugin: '@datalayer/reactor-excalidraw',
  commands: excalidrawToolDefinitions.map((definition) => ({
    name: definition.name,
    command: excalidrawCommandOf(definition.operation),
    description: definition.description,
    parameters: definition.parameters,
  })),
});

/**
 * The operation names the three halves disagree about, if any.
 *
 * A definition without an operation is a tool the model can call and nothing
 * answers; an operation without a handler is a call that reaches the executor
 * and finds nothing to run. Neither shows up until an agent tries it, which
 * is far too late — so this is checked in the tests, where it is cheap.
 */
export function excalidrawToolMismatches(
  handlers: Record<string, ExcalidrawToolHandler>,
): string[] {
  const problems: string[] = [];
  for (const definition of excalidrawToolDefinitions) {
    if (!excalidrawToolOperations[definition.operation]) {
      problems.push(
        `${definition.name} points at operation '${definition.operation}', which does not exist`,
      );
    }
    if (!definition.toolReferenceName.startsWith('excalidraw')) {
      problems.push(`${definition.name} is not named for the plugin it belongs to`);
    }
  }
  for (const name of Object.keys(excalidrawToolOperations)) {
    if (!handlers[name]) {
      problems.push(`operation '${name}' has no handler`);
    }
  }
  for (const name of Object.keys(handlers)) {
    if (!excalidrawToolOperations[name]) {
      problems.push(`handler '${name}' has no operation`);
    }
  }
  return problems;
}
