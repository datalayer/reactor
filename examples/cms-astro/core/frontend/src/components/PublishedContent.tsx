/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import '@datalayer/jupyter-lexical/style/lexical/index.css';
import 'katex/dist/katex.min.css';

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

/** Render published Lexical content entirely on the server. */
export function PublishedContent({ serverHtml }: PublishedContentProps) {
  return <ServerContent html={serverHtml} />;
}
