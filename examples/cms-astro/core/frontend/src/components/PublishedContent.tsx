/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import { lazy, Suspense, useEffect, useState } from 'react';
import '@datalayer/jupyter-lexical/style/lexical/index.css';
import 'katex/dist/katex.min.css';

const PublishedLexicalEditor = lazy(() => import('./PublishedLexicalEditor'));

export type PublishedContentProps = {
  body: string;
  lexical?: string;
  serverHtml: string;
};

function ServerContent({ html }: { html: string }) {
  return (
    <div
      className="published-lexical published-lexical-server"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** Render server HTML first, then enhance decorator nodes with Lexical. */
export function PublishedContent({ body, lexical, serverHtml }: PublishedContentProps) {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  if (!hydrated) return <ServerContent html={serverHtml} />;
  return (
    <Suspense fallback={<ServerContent html={serverHtml} />}>
      <PublishedLexicalEditor body={body} lexical={lexical} />
    </Suspense>
  );
}

