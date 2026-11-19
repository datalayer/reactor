/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * What each Mermaid tool takes.
 *
 * @module schemas
 */

import { z } from 'zod';

const diagramIdSchema = z.string().describe('The id of the diagram, from mermaidListDiagrams');

const sourceSchema = z
  .string()
  .describe(
    'Mermaid source. Its first word is the diagram type (flowchart, sequenceDiagram, classDiagram, …); mermaidListDiagramTypes lists them with an example each.',
  );

export const mermaidSetDiagramParamsSchema = z.object({
  diagramId: diagramIdSchema
    .optional()
    .describe('The diagram to replace. Omit to make a new diagram.'),
  source: sourceSchema,
  title: z.string().optional().describe('What the diagram is called, shown above it'),
});

export const mermaidReadDiagramParamsSchema = z.object({
  diagramId: diagramIdSchema,
});

export const mermaidListDiagramsParamsSchema = z.object({});

export const mermaidValidateParamsSchema = z.object({
  source: sourceSchema,
});

export const mermaidRenderSvgParamsSchema = z.object({
  diagramId: diagramIdSchema.optional().describe('The diagram to render. Give this or source.'),
  source: sourceSchema.optional().describe('Source to render without saving it. Give this or diagramId.'),
});

export const mermaidListDiagramTypesParamsSchema = z.object({});

export type MermaidSetDiagramParams = z.infer<typeof mermaidSetDiagramParamsSchema>;
export type MermaidReadDiagramParams = z.infer<typeof mermaidReadDiagramParamsSchema>;
export type MermaidListDiagramsParams = z.infer<typeof mermaidListDiagramsParamsSchema>;
export type MermaidValidateParams = z.infer<typeof mermaidValidateParamsSchema>;
export type MermaidRenderSvgParams = z.infer<typeof mermaidRenderSvgParamsSchema>;
export type MermaidListDiagramTypesParams = z.infer<typeof mermaidListDiagramTypesParamsSchema>;
