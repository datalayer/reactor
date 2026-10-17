/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * The renderer for an approval: the fields, the page-only note and history,
 * and Approve / Reject when the display still offers the decision.
 */

import { useState } from 'react';
import type { RendererProps } from '../../../src/react/ui';
import { approvalFields, DECIDE } from './approval';

const STATUS_COLOR = { pending: '#9a6700', approved: '#1a7f37', rejected: '#cf222e' } as const;

export default function ApprovalCard({ display, act }: RendererProps) {
  const approval = approvalFields(display);
  const [comment, setComment] = useState('');
  const offered = act !== undefined && (display.actions ?? []).some((offer) => offer.name === DECIDE);

  const decide = (approve: boolean) =>
    act?.({ action: DECIDE, payload: { approve, comment }, idempotency_id: crypto.randomUUID() });

  return (
    <article
      data-approval={display.id}
      style={{ border: '1px solid #d0d7de', borderRadius: 8, padding: 12, margin: '8px 0', maxWidth: 480 }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
        <strong>{approval.title}</strong>
        <span style={{ color: STATUS_COLOR[approval.status] ?? 'inherit' }}>{approval.status}</span>
      </header>
      <p style={{ margin: '4px 0' }}>
        {approval.amount_eur.toFixed(2)} EUR, requested by {approval.requester}
      </p>
      {approval.reviewer_note ? (
        <p style={{ margin: '4px 0', fontStyle: 'italic' }}>Note for the reviewer: {approval.reviewer_note}</p>
      ) : null}
      {approval.history?.length ? (
        <ul style={{ margin: '4px 0' }}>
          {approval.history.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      ) : null}
      {offered ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input
            aria-label="Comment"
            placeholder="Comment (stays on the page)"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            style={{ flex: 1 }}
          />
          <button onClick={() => decide(true)}>Approve</button>
          <button onClick={() => decide(false)}>Reject</button>
        </div>
      ) : null}
    </article>
  );
}
