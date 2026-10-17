/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

import { describe, expect, it } from 'vitest';
import { buildReactorFromPlugins } from '../../../../src';
import {
  applyUiOp,
  applyUiOps,
  emptyUiModel,
  isUiOp,
  orderedDisplays,
  resolveRenderer,
  resolveToolResult,
  type UiOp,
} from '../../../../src/ui';
import recorded from '../../fixtures/demo-ops.json';
import { APPROVAL_TYPE, approvalFields } from '../approval';
import { ApprovalsPlugin } from '../approvalPlugin';

/** The session `ui_channel_example.scripted` records; the Python test keeps it current. */
const OPS = recorded as unknown[];

function started() {
  const reactor = buildReactorFromPlugins([ApprovalsPlugin]);
  reactor.start();
  return reactor;
}

describe('the approvals plugin', () => {
  it('claims version 1 of the approval type, and nothing else', () => {
    const reactor = started();
    expect(resolveRenderer(reactor, { type: APPROVAL_TYPE, version: 1 })?.value.load).toBeTypeOf('function');
    expect(resolveRenderer(reactor, { type: APPROVAL_TYPE, version: 2 })).toBeUndefined();
    expect(resolveRenderer(reactor, { type: 'application/vnd.reactor-example.receipt+json' })).toBeUndefined();
  });

  it('takes its renderer with it when disabled', () => {
    const reactor = started();
    reactor.disable('@example/approvals');
    expect(resolveRenderer(reactor, { type: APPROVAL_TYPE, version: 1 })).toBeUndefined();
  });

  it('draws a request_approval result, prefixed or not, as an approval', () => {
    const reactor = started();
    const result = { title: 'Ticket', amount_eur: 420, requester: 'ada', status: 'pending' };
    for (const toolName of ['request_approval', 'mcp.request_approval', 'gateway_request_approval']) {
      const display = resolveToolResult(reactor, { toolName, result, toolCallId: 'call-1' });
      expect(display).toMatchObject({ type: APPROVAL_TYPE, version: 1, id: 'call-1' });
      expect(approvalFields(display!)).toEqual(result);
    }
    expect(resolveToolResult(reactor, { toolName: 'request_approvals', result })).toBeUndefined();
  });
});

describe('the recorded session', () => {
  it('is reactor.ui ops, every one', () => {
    expect(OPS.every(isUiOp)).toBe(true);
  });

  it('ends with the laptop approved, its history appended and its offer gone', () => {
    const model = applyUiOps(emptyUiModel(), OPS as UiOp[]);
    expect(orderedDisplays(model).map((display) => display.id)).toEqual(['laptop', 'train']);
    const laptop = model.displays.laptop;
    expect(laptop.text).toBe('Laptop: 1890.00 EUR for ada (approved)');
    expect(approvalFields(laptop)).toMatchObject({
      status: 'approved',
      history: ['approved by grace: Fine, it replaces the 2019 one'],
    });
    expect(laptop.actions).toEqual([]);
    expect(model.displays.train.actions?.map((offer) => offer.name)).toEqual(['approvals.decide']);
    expect(model.state).toEqual({ last_decision: { id: 'laptop', status: 'approved' } });
    expect(model.meta).toEqual({ title: 'Approvals' });
  });

  it('never carries the secret', () => {
    expect(JSON.stringify(OPS)).not.toContain('vk-');
    expect(Object.keys(approvalFields(applyUiOps(emptyUiModel(), OPS as UiOp[]).displays.laptop))).not.toContain(
      'vendor_key',
    );
  });

  it('leaves the model as it was on a window op', () => {
    const before = applyUiOps(emptyUiModel(), (OPS as UiOp[]).slice(0, -1));
    const windowOp = OPS[OPS.length - 1] as UiOp;
    expect(windowOp.op).toBe('window');
    expect(applyUiOp(before, windowOp)).toBe(before);
  });

  it('refuses a patch before the show, and a pointer into a prototype', () => {
    const patch = OPS.find((op) => (op as UiOp).op === 'patch') as UiOp;
    expect(() => applyUiOp(emptyUiModel(), patch)).toThrow(/never shown/);
    const shown = applyUiOps(emptyUiModel(), (OPS as UiOp[]).slice(0, 3));
    expect(() =>
      applyUiOp(shown, {
        v: 1,
        op: 'patch',
        scope: 'demo',
        id: 'laptop',
        body: [{ op: 'add', path: '/data/__proto__/polluted', value: true }],
      }),
    ).toThrow(/never a path token/);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
