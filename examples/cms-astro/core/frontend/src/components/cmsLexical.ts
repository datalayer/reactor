/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import { CodeHighlightNode, CodeNode } from '@lexical/code';
import { HashtagNode } from '@lexical/hashtag';
import { AutoLinkNode, LinkNode } from '@lexical/link';
import { ListItemNode, ListNode } from '@lexical/list';
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

export { cmsInitialEditorState } from './cmsLexicalState';

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
