/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

import { describe, expect, it } from 'vitest';

import { detectDiagramType, MERMAID_DIAGRAM_TYPES, stripPreamble } from '../src/diagramTypes';
import { mermaidErrorOf } from '../src/errors';

describe('which type a source is', () => {
  it('reads the first word', () => {
    expect(detectDiagramType('flowchart LR\n A-->B')?.type).toBe('flowchart');
    expect(detectDiagramType('graph TD;A-->B')?.type).toBe('flowchart');
    expect(detectDiagramType('stateDiagram-v2\n [*] --> A')?.type).toBe('state');
    expect(detectDiagramType('C4Container\n')?.type).toBe('c4');
  });

  it('looks past front matter, directives and comments', () => {
    const source = '---\ntitle: Flow\n---\n%%{init: {"theme": "dark"}}%%\n%% a comment\n\nsequenceDiagram\n A->>B: hi';
    expect(stripPreamble(source).startsWith('sequenceDiagram')).toBe(true);
    expect(detectDiagramType(source)?.type).toBe('sequence');
  });

  it('says nothing for a source no type opens', () => {
    expect(detectDiagramType('hello world')).toBeUndefined();
    expect(detectDiagramType('')).toBeUndefined();
  });

  it('gives every type a keyword, a line and an example that opens with it', () => {
    const keywords = new Set<string>();
    for (const type of MERMAID_DIAGRAM_TYPES) {
      expect(type.description.length).toBeGreaterThan(10);
      expect(detectDiagramType(type.example)?.type).toBe(type.type);
      for (const keyword of type.keywords) {
        expect(keywords.has(keyword)).toBe(false);
        keywords.add(keyword);
      }
    }
  });
});

describe("what the parser's complaint says", () => {
  it('takes the line from the parser when it gives one', () => {
    const error = Object.assign(new Error('Parse error on line 4:\n...'), {
      hash: { line: 3, loc: { first_line: 3 }, expected: ["'LINK'", "'EDGE_TEXT'"] },
    });
    expect(mermaidErrorOf(error)).toEqual({
      message: 'Parse error on line 4:\n...',
      line: 3,
      expected: ['LINK', 'EDGE_TEXT'],
    });
  });

  it('falls back to the line the message names', () => {
    expect(mermaidErrorOf(new Error('Parse error on line 7: oops')).line).toBe(7);
  });

  it('reads anything thrown, a line or not', () => {
    expect(mermaidErrorOf('No diagram type detected')).toEqual({ message: 'No diagram type detected' });
  });
});
