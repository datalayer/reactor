/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * The tools machinery every host shares: what a tool is (`ToolDefinition`),
 * how it runs (`ToolOperation`, `ToolExecutionContext`, `ToolExecutor`,
 * `DefaultExecutor`, `OperationRunner`), how its result reads
 * (`formatResponse`), how its parameters are described from a Zod schema
 * (`zodToToolParameters`, `validateWithZod`), and how a tool that streams
 * pushes its events (`ToolStreamEvent`).
 *
 * It was `@datalayer/jupyter-react/tools`'s core; moved here on 6 November
 * 2026 so that a notebook, a Lexical document, a deck, a sheet and an arena
 * describe their tools to a model with one vocabulary. The notebook's own
 * definitions and operations stay in jupyter-react; the plugins' command
 * bundles (`AgentTools`) stay in the reactor's core.
 *
 * `@datalayer/reactor/tools`.
 *
 * @module tools
 */

export * from './schema';
export * from './interfaces';
export * from './executor';
export * from './formatter';
export * from './operationRunner';
export * from './zodUtils';
