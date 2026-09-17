/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import { $convertFromMarkdownString, TRANSFORMERS } from '@lexical/markdown';
import type { InitialConfigType } from '@lexical/react/LexicalComposer';

const markdownPattern =
  /(^|\n)\s{0,3}(#{1,6}\s|>\s|[-+*]\s|\d+\.\s|```|---\s*$)|(\*\*|__)[^\n]+\3/m;

function isLegacyMarkdownMirror(serialized: string, body: string): boolean {
  if (!markdownPattern.test(body)) return false;
  try {
    const state = JSON.parse(serialized) as { root?: Record<string, unknown> };
    const visit = (node: Record<string, unknown>): boolean => {
      const type = node.type;
      if (!['root', 'paragraph', 'text', 'linebreak'].includes(String(type))) return false;
      if (type === 'text' && (Number(node.format ?? 0) !== 0 || String(node.style ?? '') !== '')) return false;
      const children = node.children;
      return !Array.isArray(children) || children.every(child => visit(child as Record<string, unknown>));
    };
    return Boolean(state.root && visit(state.root));
  } catch {
    return false;
  }
}

/** Select rich state, or convert legacy Markdown inside an active editor. */
export function cmsInitialEditorState(
  serialized: string | undefined,
  markdown: string,
): InitialConfigType['editorState'] {
  if (serialized && !isLegacyMarkdownMirror(serialized, markdown)) return serialized;
  if (!markdown) return undefined;
  return () => $convertFromMarkdownString(markdown, TRANSFORMERS);
}

