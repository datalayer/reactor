/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * The half of the Mermaid tools that does the work, over a host and an
 * engine.
 *
 * A source is checked before it is kept: a diagram on the page is always one
 * Mermaid draws, and a model that wrote a bad line is told which line rather
 * than finding a blank where its diagram should be.
 *
 * @module handlers
 */

import { detectDiagramType, MERMAID_DIAGRAM_TYPES } from './diagramTypes';
import { mermaidErrorOf, type MermaidSourceError } from './errors';
import type { MermaidDiagramHost, MermaidEngine } from './host';

/** One handler: the validated arguments of a call, and its answer. */
export type MermaidToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

/** Check a source with Mermaid's parser. */
export async function validateMermaid(
  engine: MermaidEngine,
  source: string,
): Promise<{ valid: boolean; diagramType?: string; errors: MermaidSourceError[] }> {
  const diagramType = detectDiagramType(source)?.type;
  if (!source.trim()) {
    return { valid: false, diagramType, errors: [{ message: 'The source is empty.' }] };
  }
  try {
    const answer = await engine.parse(source);
    if (answer === false) {
      return { valid: false, diagramType, errors: [{ message: 'Mermaid did not parse the source.' }] };
    }
    return { valid: true, diagramType, errors: [] };
  } catch (error) {
    const found = mermaidErrorOf(error);
    if (!diagramType) {
      found.message += ' The first word of a source names its type: call mermaidListDiagramTypes for them.';
    }
    return { valid: false, diagramType, errors: [found] };
  }
}

/** A refusal that carries the parser's words and line. */
function refusal(errors: MermaidSourceError[]): Error {
  const said = errors
    .map((error) => (error.line ? `line ${error.line}: ${error.message}` : error.message))
    .join('; ');
  return new Error(`That Mermaid source does not parse — ${said}`);
}

let rendered = 0;

/** Every Mermaid handler, keyed by the operation the executor looks up. */
export function createMermaidToolHandlers(
  host: MermaidDiagramHost,
  engine: MermaidEngine,
): Record<string, MermaidToolHandler> {
  return {
    mermaidSetDiagram: async (args) => {
      const source = String(args.source);
      const checked = await validateMermaid(engine, source);
      if (!checked.valid) {
        throw refusal(checked.errors);
      }
      const title = args.title === undefined ? undefined : String(args.title);
      if (args.diagramId) {
        const before = await host.readDiagram(String(args.diagramId));
        await host.writeDiagram({ ...before, source, ...(title !== undefined ? { title } : {}) });
        return {
          success: true,
          diagramId: before.id,
          diagramType: checked.diagramType,
          created: false,
          message: `Diagram '${before.id}' replaced`,
        };
      }
      const diagramId = await host.insertDiagram({ source, ...(title !== undefined ? { title } : {}) });
      return {
        success: true,
        diagramId,
        diagramType: checked.diagramType,
        created: true,
        message: `Diagram '${diagramId}' created`,
      };
    },

    mermaidReadDiagram: async (args) => {
      const diagram = await host.readDiagram(String(args.diagramId));
      return {
        diagramId: diagram.id,
        title: diagram.title,
        source: diagram.source,
        diagramType: detectDiagramType(diagram.source)?.type,
      };
    },

    mermaidListDiagrams: async () => {
      const diagrams = (await host.listDiagrams()).map((diagram) => ({
        diagramId: diagram.id,
        title: diagram.title,
        diagramType: detectDiagramType(diagram.source)?.type,
        lines: diagram.source.split(/\r?\n/).length,
      }));
      return { diagrams, count: diagrams.length };
    },

    mermaidValidate: async (args) => validateMermaid(engine, String(args.source)),

    mermaidRenderSvg: async (args) => {
      const hasId = args.diagramId !== undefined;
      const hasSource = args.source !== undefined;
      if (hasId === hasSource) {
        throw new Error('Give either diagramId or source, not both and not neither.');
      }
      const diagram = hasId ? await host.readDiagram(String(args.diagramId)) : undefined;
      const source = diagram ? diagram.source : String(args.source);
      const checked = await validateMermaid(engine, source);
      if (!checked.valid) {
        throw refusal(checked.errors);
      }
      const { svg } = await engine.render(`mermaid-svg-${(rendered += 1)}`, source);
      return { svg, diagramType: checked.diagramType, ...(diagram ? { diagramId: diagram.id } : {}) };
    },

    mermaidListDiagramTypes: async () => ({
      types: MERMAID_DIAGRAM_TYPES,
      count: MERMAID_DIAGRAM_TYPES.length,
    }),
  };
}
