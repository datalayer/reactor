/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * What a tool is, said once for every host: its names, what the model is
 * told, the JSON Schema of what it takes, and the operation that does it.
 *
 * Moved here from `@datalayer/jupyter-react/tools` (6 November 2026): the
 * notebook was the first document with tools, and the shape it settled on is
 * the one a Lexical document, a deck, a sheet and an arena share. The
 * reactor is where every host reads one vocabulary, so the vocabulary lives
 * here and the notebook's definitions import it.
 *
 * @module tools/schema
 */

/** How a host presents a tool: confirmations, invocation lines, ranking. */
export interface ToolConfig<TParams = unknown> {
  /** Confirmation message from parameters */
  confirmationMessage?: (params: TParams) => string;
  /** Invocation message from parameters */
  invocationMessage?: (params: TParams) => string;
  /** Require user confirmation */
  requiresConfirmation?: boolean;
  /** Can be referenced in prompts */
  canBeReferencedInPrompt?: boolean;
  /** Priority for suggestion ranking */
  priority?: 'low' | 'medium' | 'high';
  /** Platform-specific config extensions */
  [key: string]: unknown;
}

/** The JSON Schema a tool's parameters are described with. */
export interface ToolParameters {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

/** One tool, as a model is told it and as a host runs it. */
export interface ToolDefinition<TParams = unknown> {
  /** Vendor-prefixed tool name (e.g., "datalayer_insertCell") */
  name: string;
  /** Display name */
  displayName: string;
  /** User-facing reference name (e.g., "insertCell") */
  toolReferenceName: string;
  /** Tool description */
  description: string;
  /** JSON Schema for parameters */
  parameters: ToolParameters;
  /** Operation handler name */
  operation: string;
  /** Tool configuration */
  config?: ToolConfig<TParams>;
  /** Categorization tags */
  tags?: string[];
  /**
   * The tool streams: its call returns at once, *subscribed*, and the host
   * keeps pushing events until the subscription ends — an arena saying
   * where the ball is, rather than waiting to be asked. Its operation has a
   * `subscribe` beside its `execute`.
   */
  streams?: boolean;
}
