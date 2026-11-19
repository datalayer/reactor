/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * The agent-facing half of the Mermaid tools: each validates its parameters
 * and hands them to the executor, which runs the handler over the host that
 * keeps the diagrams. Nothing here imports Mermaid, so the tool list loads in
 * Node.
 *
 * @module operations
 */

import {
  validateWithZod,
  type ToolExecutionContext,
  type ToolOperation,
} from '@datalayer/reactor/tools';
import type { z } from 'zod';

import type { MermaidDiagramType } from './diagramTypes';
import type { MermaidSourceError } from './errors';
import {
  mermaidListDiagramsParamsSchema,
  mermaidListDiagramTypesParamsSchema,
  mermaidReadDiagramParamsSchema,
  mermaidRenderSvgParamsSchema,
  mermaidSetDiagramParamsSchema,
  mermaidValidateParamsSchema,
} from './schemas';

function mermaidOperation<TResult>(name: string, schema: z.ZodTypeAny): ToolOperation<unknown, TResult> {
  return {
    name,
    async execute(params: unknown, context: ToolExecutionContext): Promise<TResult> {
      const validated = validateWithZod(schema as any, params ?? {}, name);
      if (!context.executor) {
        throw new Error(
          `Executor is required for ${name}. ` +
            'This should be provided by the platform (DefaultExecutor, BridgeExecutor, etc.)',
        );
      }
      try {
        return (await context.executor.execute(name, validated as Record<string, unknown>)) as TResult;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to run ${name}: ${message}`, { cause: error });
      }
    },
  };
}

// ============================================================================
// Results
// ============================================================================

/** A diagram, as a listing shows it. */
export interface MermaidDiagramSummary {
  diagramId: string;
  title?: string;
  /** The type its first word names, or undefined. */
  diagramType?: string;
  lines: number;
}

/** What writing a diagram reports back. */
export interface MermaidSetDiagramResult {
  success: true;
  diagramId: string;
  diagramType?: string;
  created: boolean;
  message: string;
}

/** What reading a diagram reports back. */
export interface MermaidReadDiagramResult {
  diagramId: string;
  title?: string;
  source: string;
  diagramType?: string;
}

/** What a listing reports back. */
export interface MermaidListDiagramsResult {
  diagrams: MermaidDiagramSummary[];
  count: number;
}

/** What a check reports back. */
export interface MermaidValidateResult {
  valid: boolean;
  diagramType?: string;
  errors: MermaidSourceError[];
}

/** What a render reports back. */
export interface MermaidRenderSvgResult {
  svg: string;
  diagramType?: string;
  diagramId?: string;
}

/** What the type listing reports back. */
export interface MermaidListDiagramTypesResult {
  types: MermaidDiagramType[];
  count: number;
}

// ============================================================================
// The operations
// ============================================================================

export const mermaidSetDiagramOperation = mermaidOperation<MermaidSetDiagramResult>(
  'mermaidSetDiagram',
  mermaidSetDiagramParamsSchema,
);
export const mermaidReadDiagramOperation = mermaidOperation<MermaidReadDiagramResult>(
  'mermaidReadDiagram',
  mermaidReadDiagramParamsSchema,
);
export const mermaidListDiagramsOperation = mermaidOperation<MermaidListDiagramsResult>(
  'mermaidListDiagrams',
  mermaidListDiagramsParamsSchema,
);
export const mermaidValidateOperation = mermaidOperation<MermaidValidateResult>(
  'mermaidValidate',
  mermaidValidateParamsSchema,
);
export const mermaidRenderSvgOperation = mermaidOperation<MermaidRenderSvgResult>(
  'mermaidRenderSvg',
  mermaidRenderSvgParamsSchema,
);
export const mermaidListDiagramTypesOperation = mermaidOperation<MermaidListDiagramTypesResult>(
  'mermaidListDiagramTypes',
  mermaidListDiagramTypesParamsSchema,
);

/** Every Mermaid operation, keyed by the name its definition points at. */
export const mermaidToolOperations: Record<string, ToolOperation<unknown, unknown>> = {
  mermaidSetDiagram: mermaidSetDiagramOperation,
  mermaidReadDiagram: mermaidReadDiagramOperation,
  mermaidListDiagrams: mermaidListDiagramsOperation,
  mermaidValidate: mermaidValidateOperation,
  mermaidRenderSvg: mermaidRenderSvgOperation,
  mermaidListDiagramTypes: mermaidListDiagramTypesOperation,
} as Record<string, ToolOperation<unknown, unknown>>;
