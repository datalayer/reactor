/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * The tools over a host and an engine that stands in for Mermaid: a source
 * parses when its first line names a type and no line says `oops`.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { createMermaidToolHandlers } from '../src/handlers';
import { createMemoryDiagramHost, type MermaidEngine } from '../src/host';

const engine: MermaidEngine = {
  parse: async (source) => {
    const lines = source.split('\n');
    const bad = lines.findIndex((line) => line.includes('oops'));
    if (bad >= 0) {
      throw Object.assign(new Error(`Parse error on line ${bad + 1}`), {
        hash: { loc: { first_line: bad + 1 } },
      });
    }
    return { diagramType: 'any' };
  },
  render: async (id, source) => ({ svg: `<svg id="${id}"><!-- ${source.length} --></svg>` }),
};

let host = createMemoryDiagramHost();
let handlers = createMermaidToolHandlers(host, engine);

beforeEach(() => {
  host = createMemoryDiagramHost();
  handlers = createMermaidToolHandlers(host, engine);
});

describe('writing a diagram', () => {
  it('creates one, and says its id and type', async () => {
    const result: any = await handlers.mermaidSetDiagram({ source: 'flowchart LR\n A-->B', title: 'Flow' });
    expect(result).toMatchObject({ success: true, created: true, diagramType: 'flowchart' });
    expect(host.get(result.diagramId)).toEqual({ id: result.diagramId, source: 'flowchart LR\n A-->B', title: 'Flow' });
  });

  it('replaces the source of one by id, keeping its title', async () => {
    host.set({ id: 'd', source: 'pie\n "a": 1', title: 'Share' });
    const result: any = await handlers.mermaidSetDiagram({ diagramId: 'd', source: 'pie\n "b": 2' });
    expect(result.created).toBe(false);
    expect(host.get('d')).toEqual({ id: 'd', source: 'pie\n "b": 2', title: 'Share' });
  });

  it('refuses a source that does not parse, naming the line, and keeps what was there', async () => {
    host.set({ id: 'd', source: 'pie\n "a": 1' });
    await expect(
      handlers.mermaidSetDiagram({ diagramId: 'd', source: 'pie\n oops' }),
    ).rejects.toThrow(/does not parse — line 2/);
    expect(host.get('d')?.source).toBe('pie\n "a": 1');
  });

  it('refuses an empty source', async () => {
    await expect(handlers.mermaidSetDiagram({ source: '  ' })).rejects.toThrow(/empty/);
  });

  it('says which diagram it could not find', async () => {
    await expect(handlers.mermaidSetDiagram({ diagramId: 'ghost', source: 'pie' })).rejects.toThrow(
      /No diagram 'ghost'.*mermaidListDiagrams/,
    );
  });
});

describe('reading diagrams back', () => {
  it('reads one with its type', async () => {
    host.set({ id: 'd', source: 'gantt\n dateFormat YYYY' });
    expect(await handlers.mermaidReadDiagram({ diagramId: 'd' })).toEqual({
      diagramId: 'd',
      title: undefined,
      source: 'gantt\n dateFormat YYYY',
      diagramType: 'gantt',
    });
  });

  it('lists them in order, with their size', async () => {
    host.set({ id: 'a', source: 'pie' });
    host.set({ id: 'b', source: 'mindmap\n root\n  x', title: 'Plan' });
    expect(await handlers.mermaidListDiagrams({})).toEqual({
      count: 2,
      diagrams: [
        { diagramId: 'a', title: undefined, diagramType: 'pie', lines: 1 },
        { diagramId: 'b', title: 'Plan', diagramType: 'mindmap', lines: 3 },
      ],
    });
  });
});

describe('checking and rendering', () => {
  it('checks a source without keeping it', async () => {
    expect(await handlers.mermaidValidate({ source: 'flowchart\n oops' })).toEqual({
      valid: false,
      diagramType: 'flowchart',
      errors: [{ message: 'Parse error on line 2', line: 2 }],
    });
    expect(await host.listDiagrams()).toEqual([]);
  });

  it('tells a source with no type where the types are', async () => {
    const checked: any = await handlers.mermaidValidate({ source: 'oops' });
    expect(checked.errors[0].message).toMatch(/mermaidListDiagramTypes/);
  });

  it('renders a diagram by id, or a source given', async () => {
    host.set({ id: 'd', source: 'pie' });
    const byId: any = await handlers.mermaidRenderSvg({ diagramId: 'd' });
    expect(byId.svg).toMatch(/^<svg id="mermaid-svg-\d+"/);
    expect(byId.diagramId).toBe('d');
    const bySource: any = await handlers.mermaidRenderSvg({ source: 'flowchart LR\n A-->B' });
    expect(bySource.diagramType).toBe('flowchart');
  });

  it('asks for one of diagramId and source', async () => {
    await expect(handlers.mermaidRenderSvg({})).rejects.toThrow(/either diagramId or source/);
    await expect(handlers.mermaidRenderSvg({ diagramId: 'd', source: 'pie' })).rejects.toThrow(
      /either diagramId or source/,
    );
  });

  it('lists the types', async () => {
    const listed: any = await handlers.mermaidListDiagramTypes({});
    expect(listed.count).toBe(listed.types.length);
    expect(listed.types.map((t: any) => t.type)).toContain('sequence');
  });
});
