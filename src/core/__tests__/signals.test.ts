import { describe, expect, it } from 'vitest';
import { effect, signal } from '../../core/signals';

describe('signals', () => {
  it('unsubscribes from stale dependencies in dynamic effects', () => {
    const useFirst = signal(true);
    const first = signal(1);
    const second = signal(10);

    let runs = 0;
    let latest = 0;

    const stop = effect(() => {
      runs += 1;
      latest = useFirst.value ? first.value : second.value;
    });

    expect(runs).toBe(1);
    expect(latest).toBe(1);

    first.value = 2;
    expect(runs).toBe(2);
    expect(latest).toBe(2);

    useFirst.value = false;
    expect(runs).toBe(3);
    expect(latest).toBe(10);

    // If dependency cleanup is broken, this change would trigger another run.
    first.value = 3;
    expect(runs).toBe(3);
    expect(latest).toBe(10);

    second.value = 11;
    expect(runs).toBe(4);
    expect(latest).toBe(11);

    stop();
    second.value = 12;
    expect(runs).toBe(4);
    expect(latest).toBe(11);
  });
});
