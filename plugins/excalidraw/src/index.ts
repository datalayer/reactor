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
 * `@datalayer/reactor-excalidraw` — Excalidraw drawings as AI agent tools.
 *
 * The eleven tools an agent draws with (definitions, Zod schemas, the
 * operations that validate a call), the handlers that carry it out over any
 * host that keeps drawings, a pure scene model, and the reactor plugin that
 * offers them as commands and an `AgentTools` bundle. No editor is assumed:
 * a Lexical document, a page's canvas and a server each bring a host.
 *
 * @module index
 */

export * from './scene';
export * from './schemas';
export * from './definitions';
export * from './operations';
export * from './host';
export * from './handlers';
export * from './tools';
export * from './plugin';
export { ExcalidrawPlugin as default } from './plugin';
