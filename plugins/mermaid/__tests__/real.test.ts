// @vitest-environment jsdom
/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * The tools against Mermaid itself: the engine contract is Mermaid's own
 * `parse`, and what it throws is what the model is told.
 */

import { beforeAll, describe, expect, it } from 'vitest';

import { createMermaidToolHandlers, validateMermaid } from '../src/handlers';
import { createMemoryDiagramHost, type MermaidEngine } from '../src/host';

let engine: MermaidEngine;

beforeAll(async () => {
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({ startOnLoad: false });
  engine = mermaid;
});

describe("Mermaid's parser", () => {
  it('passes a valid flowchart', async () => {
    expect(await validateMermaid(engine, 'flowchart LR\n  A-->B')).toEqual({
      valid: true,
      diagramType: 'flowchart',
      errors: [],
    });
  });

  it('names the line of a mistake and what it expected there', async () => {
    const checked = await validateMermaid(engine, 'flowchart LR\n  A-->\n  B -- C ]');
    expect(checked.valid).toBe(false);
    expect(checked.errors[0].message).toMatch(/Parse error/);
    expect(checked.errors[0].line).toBe(3);
    expect(checked.errors[0].expected).toContain('LINK');
  });

  it('refuses to keep a source that does not parse', async () => {
    const host = createMemoryDiagramHost();
    const handlers = createMermaidToolHandlers(host, engine);
    await expect(
      handlers.mermaidSetDiagram({ source: 'sequenceDiagram\n  Alice->>' }),
    ).rejects.toThrow(/does not parse — line \d+/);
    expect(await host.listDiagrams()).toEqual([]);
  });

  it('checks every example it offers', async () => {
    const handlers = createMermaidToolHandlers(createMemoryDiagramHost(), engine);
    const { types } = (await handlers.mermaidListDiagramTypes({})) as {
      types: { type: string; example: string }[];
    };
    // The core types parse in every Mermaid since 10; the newest arrive with 11.
    for (const type of types.filter((t) =>
      ['flowchart', 'sequence', 'class', 'state', 'er', 'gantt', 'pie', 'journey', 'gitGraph', 'mindmap', 'timeline'].includes(t.type),
    )) {
      const checked = await validateMermaid(engine, type.example);
      expect({ type: type.type, ...checked }).toMatchObject({ type: type.type, valid: true });
    }
  });
});
