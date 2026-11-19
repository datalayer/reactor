/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * What the model is told the Mermaid tools do.
 *
 * The model writes Mermaid well already; what it cannot know is that a
 * diagram is addressed by an id, that a source is checked before it is
 * saved, and where the parser's complaint will say the problem is.
 *
 * @module definitions
 */

import { zodToToolParameters, type ToolDefinition } from '@datalayer/reactor/tools';

import {
  mermaidListDiagramsParamsSchema,
  mermaidListDiagramTypesParamsSchema,
  mermaidReadDiagramParamsSchema,
  mermaidRenderSvgParamsSchema,
  mermaidSetDiagramParamsSchema,
  mermaidValidateParamsSchema,
} from './schemas';

/** The vendor prefix every Datalayer tool name carries. */
const NAME = (tool: string) => `datalayer_${tool}`;

const QUIET = {
  requiresConfirmation: false,
  canBeReferencedInPrompt: true,
  priority: 'medium' as const,
};

const TAGS = ['mermaid', 'diagram'];

export const mermaidSetDiagramTool: ToolDefinition = {
  name: NAME('mermaidSetDiagram'),
  displayName: 'Write Diagram',
  toolReferenceName: 'mermaidSetDiagram',
  description:
    "Create a Mermaid diagram, or replace the source of one by its diagramId, and show it. The source is checked with Mermaid's parser first: a source that does not parse is refused with the parser's message and the line it is on, and the diagram shown stays as it was — fix that line and call again. Returns the diagramId; keep it to change or render the diagram later.",
  parameters: zodToToolParameters(mermaidSetDiagramParamsSchema),
  operation: 'mermaidSetDiagram',
  config: { ...QUIET, invocationMessage: () => 'Writing the diagram', priority: 'high' },
  tags: [...TAGS, 'edit'],
};

export const mermaidReadDiagramTool: ToolDefinition = {
  name: NAME('mermaidReadDiagram'),
  displayName: 'Read Diagram',
  toolReferenceName: 'mermaidReadDiagram',
  description:
    'Read one Mermaid diagram back: its source, its title and its type. Read it before changing a diagram a person may have edited, so the change starts from what is there.',
  parameters: zodToToolParameters(mermaidReadDiagramParamsSchema),
  operation: 'mermaidReadDiagram',
  config: { ...QUIET, invocationMessage: () => 'Reading the diagram' },
  tags: [...TAGS, 'read'],
};

export const mermaidListDiagramsTool: ToolDefinition = {
  name: NAME('mermaidListDiagrams'),
  displayName: 'List Diagrams',
  toolReferenceName: 'mermaidListDiagrams',
  description:
    'List the Mermaid diagrams there are, with the diagramId, title, type and line count of each. Call this first when asked to change "the diagram" and you do not know its diagramId.',
  parameters: zodToToolParameters(mermaidListDiagramsParamsSchema),
  operation: 'mermaidListDiagrams',
  config: { ...QUIET, invocationMessage: () => 'Looking for diagrams' },
  tags: [...TAGS, 'read'],
};

export const mermaidValidateTool: ToolDefinition = {
  name: NAME('mermaidValidate'),
  displayName: 'Check Diagram Source',
  toolReferenceName: 'mermaidValidate',
  description:
    "Check Mermaid source with Mermaid's own parser without saving or showing it. Answers whether it is valid, its diagram type, and otherwise the errors, each with its message and, when the parser says, the line and what it expected there.",
  parameters: zodToToolParameters(mermaidValidateParamsSchema),
  operation: 'mermaidValidate',
  config: { ...QUIET, invocationMessage: () => 'Checking the diagram source' },
  tags: [...TAGS, 'read', 'validate'],
};

export const mermaidRenderSvgTool: ToolDefinition = {
  name: NAME('mermaidRenderSvg'),
  displayName: 'Render Diagram to SVG',
  toolReferenceName: 'mermaidRenderSvg',
  description:
    'Render a Mermaid diagram to SVG markup, by its diagramId or from source given directly. Use it when the picture itself is needed — to put in a document, a file or a message; to show a diagram, mermaidSetDiagram is enough. The SVG is large: do not repeat it back to the person.',
  parameters: zodToToolParameters(mermaidRenderSvgParamsSchema),
  operation: 'mermaidRenderSvg',
  config: { ...QUIET, invocationMessage: () => 'Rendering the diagram' },
  tags: [...TAGS, 'render', 'svg'],
};

export const mermaidListDiagramTypesTool: ToolDefinition = {
  name: NAME('mermaidListDiagramTypes'),
  displayName: 'List Diagram Types',
  toolReferenceName: 'mermaidListDiagramTypes',
  description:
    'List the diagram types Mermaid draws — flowchart, sequence, class, state, entity relationship, Gantt, pie, mind map, timeline and the rest — with the keyword each source opens with, what each is for, and a small valid example. Types marked beta may change syntax.',
  parameters: zodToToolParameters(mermaidListDiagramTypesParamsSchema),
  operation: 'mermaidListDiagramTypes',
  config: { ...QUIET, invocationMessage: () => 'Listing the diagram types', priority: 'low' },
  tags: [...TAGS, 'read'],
};

/** Every Mermaid tool: write one, read one, find one, check, render, learn. */
export const mermaidToolDefinitions: ToolDefinition[] = [
  mermaidSetDiagramTool,
  mermaidReadDiagramTool,
  mermaidListDiagramsTool,
  mermaidValidateTool,
  mermaidRenderSvgTool,
  mermaidListDiagramTypesTool,
];
