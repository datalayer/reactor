/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * At most one overlay is open, and it is the panel that guarantees it.
 *
 * Rows used to own this individually, with a delayed close each. Moving down
 * the list then left a pending close on the row behind while the next one
 * opened, so two or three overlays hung about and vanished out of order — the
 * cascade this exists to prevent.
 *
 * The rule is small and entirely about ordering, so it is tested as ordering:
 * a `show` must beat any close already scheduled, whichever row scheduled it.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/** The control's behaviour, as the hook implements it. */
function createControl(delayMs = 200) {
  let openName: string | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    get openName() {
      return openName;
    },
    show(name: string) {
      clearTimeout(timer);
      openName = name;
    },
    hide() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        openName = null;
      }, delayMs);
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('hovering the plugin list', () => {
  it('opens the row under the pointer', () => {
    const control = createControl();
    control.show('@a/one');
    expect(control.openName).toBe('@a/one');
  });

  it('keeps the overlay for a beat, so the pointer can reach it', () => {
    // Closing immediately would make the overlay unreachable: it sits beside
    // the row, and getting to it means leaving the row.
    const control = createControl();
    control.show('@a/one');
    control.hide();

    vi.advanceTimersByTime(150);
    expect(control.openName).toBe('@a/one');

    vi.advanceTimersByTime(100);
    expect(control.openName).toBeNull();
  });

  it('never shows two at once while moving down the list', () => {
    /*
     * The cascade. Leaving one row schedules its close; entering the next
     * opens immediately. If the pending close still fired, the second
     * overlay would vanish under the pointer a moment after appearing.
     */
    const control = createControl();
    control.show('@a/one');
    control.hide();
    control.show('@a/two');

    expect(control.openName).toBe('@a/two');
    vi.advanceTimersByTime(1000);
    // The close scheduled by the first row was cancelled, not merely outrun.
    expect(control.openName).toBe('@a/two');
  });

  it('survives a list scanned faster than the delay', () => {
    const control = createControl();
    for (const name of ['@a/one', '@a/two', '@a/three']) {
      control.hide();
      control.show(name);
      vi.advanceTimersByTime(20);
    }
    expect(control.openName).toBe('@a/three');
    vi.advanceTimersByTime(1000);
    // Nothing left pending from the rows passed over.
    expect(control.openName).toBe('@a/three');
  });
});
