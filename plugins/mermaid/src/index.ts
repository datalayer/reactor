/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * `@datalayer/reactor-mermaid` — Mermaid diagrams as AI agent tools.
 *
 * Six tools: write a diagram (checked first), read it back, list the
 * diagrams, check a source with Mermaid's parser, render to SVG, and list the
 * diagram types. The handlers run over any host that keeps diagrams and any
 * Mermaid the host hands in; the reactor plugin offers them as commands and
 * an `AgentTools` bundle.
 *
 * @module index
 */

export * from './diagramTypes';
export * from './errors';
export * from './schemas';
export * from './definitions';
export * from './operations';
export * from './host';
export * from './handlers';
export * from './tools';
export * from './plugin';
export { MermaidPlugin as default } from './plugin';
