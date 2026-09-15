/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import { useMemo } from 'react';
import { CheckListPlugin } from '@lexical/react/LexicalCheckListPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import {
  LexicalComposer,
  type InitialConfigType,
} from '@lexical/react/LexicalComposer';
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary';
import { HashtagPlugin } from '@lexical/react/LexicalHashtagPlugin';
import { HorizontalRulePlugin } from '@lexical/react/LexicalHorizontalRulePlugin';
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin';
import { ListPlugin } from '@lexical/react/LexicalListPlugin';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { CodeBlockHighlightPlugin } from '@datalayer/jupyter-lexical/lib/plugins/CodeHighlightPlugin.js';
import { CollapsiblePlugin } from '@datalayer/jupyter-lexical/lib/plugins/CollapsiblePlugin/index.js';
import { EquationsPlugin } from '@datalayer/jupyter-lexical/lib/plugins/EquationsPlugin.js';
import { ExcalidrawPlugin } from '@datalayer/jupyter-lexical/lib/plugins/ExcalidrawPlugin.js';
import { ImagesPlugin } from '@datalayer/jupyter-lexical/lib/plugins/ImagesPlugin.js';
import { TablePlugin } from '@datalayer/jupyter-lexical/lib/plugins/TablePlugin.js';
import { YouTubePlugin } from '@datalayer/jupyter-lexical/lib/plugins/YouTubePlugin.js';

import {
  cmsEditorNodes,
  cmsEditorTheme,
  cmsInitialEditorState,
} from './cmsLexical';
import '@datalayer/jupyter-lexical/style/lexical/index.css';

export type PublishedContentProps = {
  body: string;
  lexical?: string;
};

/** Read-only renderer for the exact Lexical document authored in the CMS. */
export function PublishedContent({ body, lexical }: PublishedContentProps) {
  const initialConfig = useMemo<InitialConfigType>(
    () => ({
      namespace: 'CmsAstroPublishedContent',
      theme: cmsEditorTheme,
      nodes: cmsEditorNodes,
      editorState: cmsInitialEditorState(lexical, body),
      editable: false,
      onError: error => {
        throw error;
      },
    }),
    [body, lexical],
  );

  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="published-lexical">
        <RichTextPlugin
          contentEditable={
            <ContentEditable
              className="published-content-input"
              aria-label="Published article content"
            />
          }
          placeholder={null}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <ListPlugin />
        <CheckListPlugin />
        <LinkPlugin />
        <HashtagPlugin />
        <CodeBlockHighlightPlugin />
        <TablePlugin />
        <CollapsiblePlugin />
        <EquationsPlugin />
        <ExcalidrawPlugin />
        <ImagesPlugin />
        <HorizontalRulePlugin />
        <YouTubePlugin />
      </div>
    </LexicalComposer>
  );
}

