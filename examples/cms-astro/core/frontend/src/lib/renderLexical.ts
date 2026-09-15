/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import { CodeHighlightNode, CodeNode } from '@lexical/code';
import { HashtagNode } from '@lexical/hashtag';
import { createHeadlessEditor } from '@lexical/headless';
import { withDOM } from '@lexical/headless/dom';
import { $generateHtmlFromNodes } from '@lexical/html';
import { AutoLinkNode, LinkNode } from '@lexical/link';
import { ListItemNode, ListNode } from '@lexical/list';
import { MarkNode } from '@lexical/mark';
import { HeadingNode, QuoteNode } from '@lexical/rich-text';
import { TableCellNode, TableNode, TableRowNode } from '@lexical/table';
import {
  DecoratorNode,
  ElementNode,
  type CreateEditorArgs,
  type DOMExportOutput,
  type NodeKey,
  type SerializedElementNode,
  type SerializedLexicalNode,
} from 'lexical';
import katex from 'katex';

import { cmsInitialEditorState } from '../components/cmsLexicalState';

type SerializedDecorator = SerializedLexicalNode & Record<string, unknown>;

abstract class ServerDecoratorNode extends DecoratorNode<null> {
  createDOM(): HTMLElement { return document.createElement('div'); }
  updateDOM(): false { return false; }
  decorate(): null { return null; }
  isInline(): false { return false; }
}

class ServerHorizontalRuleNode extends ServerDecoratorNode {
  static getType() { return 'horizontalrule'; }
  static clone(node: ServerHorizontalRuleNode) { return new ServerHorizontalRuleNode(node.__key); }
  static importJSON() { return new ServerHorizontalRuleNode(); }
  exportDOM(): DOMExportOutput { return { element: document.createElement('hr') }; }
}

class ServerEquationNode extends ServerDecoratorNode {
  constructor(private equation: string, private inline: boolean, key?: NodeKey) { super(key); }
  static getType() { return 'equation'; }
  static clone(node: ServerEquationNode) { return new ServerEquationNode(node.equation, node.inline, node.__key); }
  static importJSON(node: SerializedDecorator) { return new ServerEquationNode(String(node.equation ?? ''), Boolean(node.inline)); }
  exportDOM(): DOMExportOutput {
    const element = document.createElement(this.inline ? 'span' : 'div');
    element.className = this.inline ? 'published-equation inline' : 'published-equation block';
    element.setAttribute('data-lexical-equation', this.equation);
    element.innerHTML = katex.renderToString(this.equation, {
      displayMode: !this.inline,
      output: 'html',
      strict: 'warn',
      throwOnError: false,
      trust: false,
    });
    return { element };
  }
}

class ServerYouTubeNode extends ServerDecoratorNode {
  constructor(private videoID: string, key?: NodeKey) { super(key); }
  static getType() { return 'youtube'; }
  static clone(node: ServerYouTubeNode) { return new ServerYouTubeNode(node.videoID, node.__key); }
  static importJSON(node: SerializedDecorator) { return new ServerYouTubeNode(String(node.videoID ?? '')); }
  exportDOM(): DOMExportOutput {
    const element = document.createElement('iframe');
    element.className = 'published-youtube';
    element.src = `https://www.youtube.com/embed/${encodeURIComponent(this.videoID)}`;
    element.title = 'YouTube video';
    element.loading = 'lazy';
    element.setAttribute('allowfullscreen', '');
    element.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
    return { element };
  }
}

class ServerImageNode extends ServerDecoratorNode {
  constructor(private src: string, private altText: string, key?: NodeKey) { super(key); }
  static getType() { return 'image'; }
  static clone(node: ServerImageNode) { return new ServerImageNode(node.src, node.altText, node.__key); }
  static importJSON(node: SerializedDecorator) { return new ServerImageNode(String(node.src ?? ''), String(node.altText ?? '')); }
  exportDOM(): DOMExportOutput {
    const element = document.createElement('img');
    element.src = this.src;
    element.alt = this.altText;
    element.loading = 'lazy';
    return { element };
  }
}

class ServerExcalidrawNode extends ServerDecoratorNode {
  constructor(
    private data: string,
    private width: string | number = 'inherit',
    private height: string | number = 'inherit',
    key?: NodeKey,
  ) { super(key); }
  static getType() { return 'excalidraw'; }
  static clone(node: ServerExcalidrawNode) { return new ServerExcalidrawNode(node.data, node.width, node.height, node.__key); }
  static importJSON(node: SerializedDecorator) {
    return new ServerExcalidrawNode(
      String(node.data ?? '[]'),
      (node.width as string | number) ?? 'inherit',
      (node.height as string | number) ?? 'inherit',
    );
  }
  exportDOM(): DOMExportOutput {
    const element = document.createElement('figure');
    element.className = 'published-excalidraw';
    element.setAttribute('data-lexical-excalidraw-json', this.data);
    element.style.width = this.width === 'inherit' ? '100%' : `${this.width}px`;
    if (this.height !== 'inherit') element.style.height = `${this.height}px`;
    const caption = document.createElement('figcaption');
    caption.textContent = 'Drawing';
    element.append(caption);
    return { element };
  }
}

abstract class ServerCollapsibleElement extends ElementNode {
  updateDOM(): false { return false; }
}

class ServerCollapsibleContainerNode extends ServerCollapsibleElement {
  constructor(private open = false, key?: NodeKey) { super(key); }
  static getType() { return 'collapsible-container'; }
  static clone(node: ServerCollapsibleContainerNode) { return new ServerCollapsibleContainerNode(node.open, node.__key); }
  static importJSON(node: SerializedElementNode & { open?: boolean }) {
    return new ServerCollapsibleContainerNode(Boolean(node.open)).updateFromJSON(node);
  }
  createDOM(): HTMLElement { const element = document.createElement('details'); element.open = this.open; return element; }
  exportDOM(): DOMExportOutput { const element = document.createElement('details'); element.open = this.open; element.className = 'Collapsible__container'; return { element }; }
}

class ServerCollapsibleTitleNode extends ServerCollapsibleElement {
  static getType() { return 'collapsible-title'; }
  static clone(node: ServerCollapsibleTitleNode) { return new ServerCollapsibleTitleNode(node.__key); }
  static importJSON(node: SerializedElementNode) { return new ServerCollapsibleTitleNode().updateFromJSON(node); }
  createDOM(): HTMLElement { return document.createElement('summary'); }
  exportDOM(): DOMExportOutput { const element = document.createElement('summary'); element.className = 'Collapsible__title'; return { element }; }
}

class ServerCollapsibleContentNode extends ServerCollapsibleElement {
  static getType() { return 'collapsible-content'; }
  static clone(node: ServerCollapsibleContentNode) { return new ServerCollapsibleContentNode(node.__key); }
  static importJSON(node: SerializedElementNode) { return new ServerCollapsibleContentNode().updateFromJSON(node); }
  createDOM(): HTMLElement { return document.createElement('div'); }
  exportDOM(): DOMExportOutput { const element = document.createElement('div'); element.className = 'Collapsible__content'; return { element }; }
}

const serverNodes = [
  AutoLinkNode, CodeNode, CodeHighlightNode, HashtagNode, HeadingNode, LinkNode,
  ListItemNode, ListNode, MarkNode, QuoteNode, TableCellNode, TableNode, TableRowNode,
  ServerCollapsibleContainerNode, ServerCollapsibleContentNode, ServerCollapsibleTitleNode,
  ServerEquationNode, ServerExcalidrawNode, ServerHorizontalRuleNode, ServerImageNode,
  ServerYouTubeNode,
] as unknown as NonNullable<CreateEditorArgs['nodes']>;

/** Render the CMS Lexical state synchronously into the initial Astro response. */
export function renderLexicalHtml(serialized: string | undefined, body: string): string {
  return withDOM(() => {
    const editor = createHeadlessEditor({
      namespace: 'CmsAstroServerRenderer',
      nodes: serverNodes,
      editable: false,
      onError: error => { throw error; },
    });
    const initialState = cmsInitialEditorState(serialized, body);
    if (typeof initialState === 'string') editor.setEditorState(editor.parseEditorState(initialState));
    else if (typeof initialState === 'function') editor.update(() => initialState(editor), { discrete: true });
    return editor.read(() => $generateHtmlFromNodes(editor));
  });
}
