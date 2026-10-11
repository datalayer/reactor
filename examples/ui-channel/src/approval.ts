/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The approval display, as the page reads it. `ui_channel_example.approval`
 * declares it in Python; this is what arrives as its `data`.
 */

import type { Display } from '../../../src/ui';

export const APPROVAL_TYPE = 'application/vnd.reactor-example.approval+json';

/** The one action an approval offers. */
export const DECIDE = 'approvals.decide';

export type ApprovalFields = {
  title: string;
  amount_eur: number;
  requester: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewer_note?: string;
  history?: string[];
};

/**
 * The approval's fields, wherever the display came from: the host showed it
 * (its `data`), or a bound tool returned it (`data.result`, as
 * `resolveToolResult` wraps a raw result).
 */
export function approvalFields(display: Display): ApprovalFields {
  const data = display.data ?? {};
  const fields = 'toolName' in data && typeof data.result === 'object' && data.result !== null ? data.result : data;
  return fields as ApprovalFields;
}
