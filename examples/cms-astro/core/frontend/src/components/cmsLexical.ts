/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import { CodeHighlightNode, CodeNode } from '@lexical/code';
import { HashtagNode } from '@lexical/hashtag';
import { AutoLinkNode, LinkNode } from '@lexical/link';
import { ListItemNode, ListNode } from '@lexical/list';
import { $convertFromMarkdownString, TRANSFORMERS } from '@lexical/markdown';
import { MarkNode } from '@lexical/mark';
import { HorizontalRuleNode } from '@lexical/react/LexicalHorizontalRuleNode';
import type { InitialConfigType } from '@lexical/react/LexicalComposer';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { TableCellNode, TableNode, TableRowNode } from '@lexical/table';
import { EquationNode } from '@datalayer/jupyter-lexical/lib/nodes/EquationNode.js';
import { ExcalidrawNode } from '@datalayer/jupyter-lexical/lib/nodes/ExcalidrawNode.js';
import { ImageNode } from '@datalayer/jupyter-lexical/lib/nodes/ImageNode.js';
import { YouTubeNode } from '@datalayer/jupyter-lexical/lib/nodes/YouTubeNode.js';
import {
  CollapsibleContainerNode,
  CollapsibleContentNode,
  CollapsibleTitleNode,
} from '@datalayer/jupyter-lexical/lib/plugins/CollapsiblePlugin/index.js';
import { commentTheme } from '@datalayer/jupyter-lexical/lib/themes/CommentEditorTheme.js';

export const cmsEditorNodes: InitialConfigType['nodes'] = [
  AutoLinkNode,
  CodeNode,
  CodeHighlightNode,
  CollapsibleContainerNode,
  CollapsibleContentNode,
  CollapsibleTitleNode,
  EquationNode,
  ExcalidrawNode,
  HashtagNode,
  HeadingNode,
  HorizontalRuleNode,
  ImageNode,
  LinkNode,
  ListItemNode,
  ListNode,
  MarkNode,
  QuoteNode,
  TableCellNode,
  TableNode,
  TableRowNode,
  YouTubeNode,
];

export const cmsEditorTheme = commentTheme;

const markdownPattern =
  /(^|\n)\s{0,3}(#{1,6}\s|>\s|[-+*]\s|\d+\.\s|```|---\s*$)|(\*\*|__)[^\n]+\3/m;

/**
 * Old CMS entries stored Markdown in `body`. Early editor versions also
 * mirrored it into a single unformatted Lexical paragraph. Prefer Markdown
 * conversion for that legacy shape, while preserving all genuinely rich
 * serialized editor states.
 */
function isLegacyMarkdownMirror(serialized: string, body: string): boolean {
  if (!markdownPattern.test(body)) return false;
  try {
    const state = JSON.parse(serialized) as {
      root?: { children?: Array<Record<string, unknown>> };
    };
    const visit = (node: Record<string, unknown>): boolean => {
      const type = node.type;
      if (!['root', 'paragraph', 'text', 'linebreak'].includes(String(type))) {
        return false;
      }
      if (
        type === 'text' &&
        (Number(node.format ?? 0) !== 0 || String(node.style ?? '') !== '')
      ) {
        return false;
      }
      const children = node.children;
      return !Array.isArray(children) ||
        children.every(child => visit(child as Record<string, unknown>));
    };
    return Boolean(state.root && visit(state.root as Record<string, unknown>));
  } catch {
    return false;
  }
}

export function cmsInitialEditorState(
  serialized: string | undefined,
  markdown: string,
): InitialConfigType['editorState'] {
  if (serialized && !isLegacyMarkdownMirror(serialized, markdown)) {
    return serialized;
  }
  if (!markdown) return undefined;
  return () => $convertFromMarkdownString(markdown, TRANSFORMERS);
}

