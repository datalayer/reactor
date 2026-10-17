/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

import { describe, expect, it } from 'vitest';
import { AGUI_NAME, AguiUiDecoder, type AguiEvent } from '../agui';
import { applyUiOps, emptyUiModel } from '../reducer';
import type { UiOp } from '../wire';

type Examples = { ops: UiOp[]; events: AguiEvent[] };

/** What `encode_agui` sends for a sequence of ops (`tests/test_ui_agui_examples.py` keeps it so). */
async function examples(): Promise<Examples> {
  const fs: string = 'node:fs';
  const { readFileSync } = await import(/* @vite-ignore */ fs);
  const url = new URL('../../../schema/reactor-ui.v1.agui-examples.json', import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as Examples;
}

const decodeAll = (events: AguiEvent[]): UiOp[] => {
  const decoder = new AguiUiDecoder();
  return events.map((event) => decoder.decode(event)).filter((op): op is UiOp => op !== null);
};

describe('AguiUiDecoder', () => {
  it('turns what encode_agui sent back into ops the reducer ends the same with', async () => {
    const { ops, events } = await examples();
    const decoded = decodeAll(events);
    expect(decoded.map((op) => op.op)).toEqual(['show', 'patch', 'patch', 'meta', 'ask', 'remove']);
    expect(applyUiOps(emptyUiModel(), decoded)).toEqual(applyUiOps(emptyUiModel(), ops));
  });

  it('keeps the scope a display was shown under for its deltas', async () => {
    const { events } = await examples();
    const [, patch] = decodeAll(events);
    expect(patch).toMatchObject({ op: 'patch', scope: 's1', id: 'card-1' });
    expect(patch.op === 'patch' && patch.body[1]).toEqual({ op: 'copy', path: '/data/was', from: '/data/status' });
  });

  it('leaves every other event to the host', () => {
    const decoder = new AguiUiDecoder();
    expect(decoder.decode({ type: 'TEXT_MESSAGE_START', messageId: 'm' })).toBeNull();
    expect(decoder.decode({ type: 'CUSTOM', name: 'something.else', value: {} })).toBeNull();
    expect(decoder.decode({ type: 'ACTIVITY_SNAPSHOT', activityType: 'other', messageId: 'a', content: {} })).toBeNull();
    expect(decoder.decode({ type: 'STATE_DELTA', delta: [] })).toBeNull();
  });

  it('refuses what is the reactor’s but not its shape', () => {
    const decoder = new AguiUiDecoder();
    expect(() =>
      decoder.decode({ type: 'ACTIVITY_DELTA', activityType: AGUI_NAME, messageId: 'never', patch: [] }),
    ).toThrow(/never shown/);
    expect(() => decoder.decode({ type: 'CUSTOM', name: AGUI_NAME, value: { op: 'show' } })).toThrow(/not an op/);
    expect(() =>
      decoder.decode({ type: 'ACTIVITY_SNAPSHOT', activityType: AGUI_NAME, messageId: 'a', content: { scope: 's' } }),
    ).toThrow(/scope, display/);
    decoder.decode({
      type: 'ACTIVITY_SNAPSHOT',
      activityType: AGUI_NAME,
      messageId: 'a',
      content: { scope: 's', display: { type: 'application/x', id: 'a', text: 'A' } },
    });
    expect(() =>
      decoder.decode({
        type: 'ACTIVITY_DELTA',
        activityType: AGUI_NAME,
        messageId: 'a',
        patch: [{ op: 'replace', path: '/elsewhere', value: 1 }],
      }),
    ).toThrow(/not under \/display/);
  });
});
