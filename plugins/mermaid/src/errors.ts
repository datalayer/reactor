/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * What Mermaid's parser says is wrong, in a shape a model can act on.
 *
 * Mermaid's grammars throw with a message that names the line ("Parse error
 * on line 3: …") and, for the generated parsers, a `hash` that carries it as
 * data. Either way, the line is what lets a model fix one line rather than
 * rewrite the diagram.
 *
 * @module errors
 */

/** One problem in a source. */
export interface MermaidSourceError {
  message: string;
  /** The line it is on, counting from 1, when the parser said. */
  line?: number;
  /** What the parser expected there, when it said. */
  expected?: string[];
}

/** Read what a parse failure says. */
export function mermaidErrorOf(error: unknown): MermaidSourceError {
  const message = (error instanceof Error ? error.message : String(error)).trim();
  const hash = (error as { hash?: { line?: number; loc?: { first_line?: number }; expected?: unknown } })
    ?.hash;
  const result: MermaidSourceError = { message };
  const fromHash = hash?.loc?.first_line ?? (typeof hash?.line === 'number' ? hash.line + 1 : undefined);
  const fromMessage = /on line (\d+)/i.exec(message)?.[1];
  const line = fromHash ?? (fromMessage ? Number(fromMessage) : undefined);
  if (line !== undefined && Number.isFinite(line)) {
    result.line = line;
  }
  if (Array.isArray(hash?.expected) && hash.expected.length > 0) {
    result.expected = hash.expected.map((entry) => String(entry).replace(/^'|'$/g, ''));
  }
  return result;
}
