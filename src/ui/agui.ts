/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * AG-UI events back into ops: the page's twin of `reactor.ui.agui.encode_agui`.
 *
 * - `ACTIVITY_SNAPSHOT` of activity type `reactor.ui` → `show`.
 * - `ACTIVITY_DELTA` of activity type `reactor.ui` → `patch` of that display,
 *   the paths taken back out from under `/display` (an `append` arrives as an
 *   `add` at `<path>/-`, which a patch applies the same way).
 * - `CUSTOM` named `reactor.ui` → the op it carries, whole.
 *
 * `STATE_DELTA` is not decoded: the encoder sends a `state` op as the stream's
 * own state, which the host reads as it reads any. Every other event is not
 * the reactor's: `null`.
 *
 * A delta does not say its scope; the decoder remembers the scope of each
 * display it saw shown. A delta for a display it never saw, or an event of
 * the reactor's that does not have its shape, is refused: it throws.
 *
 * @module ui/agui
 */

import { isDisplay, isPatchOperation, isUiOp, UI_WIRE_VERSION, type PatchOperation, type UiOp } from './wire';

/** The activity type and custom-event name every op is carried under. */
export const AGUI_NAME = 'reactor.ui';

/** An AG-UI event as it arrives, in its JSON form (camelCase). */
export type AguiEvent = { type: string; [key: string]: unknown };

const UNDER = '/display';

function fromUnderDisplay(pointer: unknown, event: string): string {
  if (typeof pointer !== 'string' || !(pointer === UNDER || pointer.startsWith(`${UNDER}/`))) {
    throw new Error(`${event}: ${String(pointer)} is not under ${UNDER}`);
  }
  return pointer.slice(UNDER.length);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Decodes one stream's AG-UI events into ops, remembering each display's scope. */
export class AguiUiDecoder {
  private readonly scopes = new Map<string, string>();

  /** The op an event carries, or `null` for an event that is not the reactor's. */
  decode(event: AguiEvent): UiOp | null {
    switch (event.type) {
      case 'ACTIVITY_SNAPSHOT': {
        if (event.activityType !== AGUI_NAME) {
          return null;
        }
        const content = event.content;
        if (!isRecord(content) || typeof content.scope !== 'string' || !isDisplay(content.display)) {
          throw new Error('ACTIVITY_SNAPSHOT reactor.ui: its content is not { scope, display }');
        }
        if (content.display.id !== event.messageId) {
          throw new Error(
            `ACTIVITY_SNAPSHOT reactor.ui: display ${content.display.id} under activity ${String(event.messageId)}`,
          );
        }
        this.scopes.set(content.display.id, content.scope);
        return { v: UI_WIRE_VERSION, op: 'show', scope: content.scope, id: content.display.id, body: content.display };
      }
      case 'ACTIVITY_DELTA': {
        if (event.activityType !== AGUI_NAME) {
          return null;
        }
        const id = event.messageId;
        const scope = typeof id === 'string' ? this.scopes.get(id) : undefined;
        if (typeof id !== 'string' || scope === undefined) {
          throw new Error(`ACTIVITY_DELTA reactor.ui: display ${String(id)} was never shown`);
        }
        if (!Array.isArray(event.patch)) {
          throw new Error('ACTIVITY_DELTA reactor.ui: no patch');
        }
        const body = event.patch.map((operation): PatchOperation => {
          if (!isPatchOperation(operation)) {
            throw new Error(`ACTIVITY_DELTA reactor.ui: ${JSON.stringify(operation)} is not a patch operation`);
          }
          const rebased = { ...operation, path: fromUnderDisplay(operation.path, 'ACTIVITY_DELTA') };
          if ('from' in operation) {
            (rebased as { from: string }).from = fromUnderDisplay(operation.from, 'ACTIVITY_DELTA');
          }
          return rebased as PatchOperation;
        });
        return { v: UI_WIRE_VERSION, op: 'patch', scope, id, body };
      }
      case 'CUSTOM': {
        if (event.name !== AGUI_NAME) {
          return null;
        }
        if (!isUiOp(event.value)) {
          throw new Error('CUSTOM reactor.ui: its value is not an op');
        }
        const op = event.value;
        if (op.op === 'remove') {
          this.scopes.delete(op.id);
        } else if (op.op === 'ask') {
          this.scopes.set(op.body.id, op.scope);
        }
        return op;
      }
      default:
        return null;
    }
  }
}
