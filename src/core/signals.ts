/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

export type Unsubscribe = () => void;

type Subscriber = () => void;

let activeEffect: ReactiveEffect | null = null;
let batchDepth = 0;
const pendingSubscribers = new Set<Subscriber>();

class ReactiveEffect {
  readonly runFn: () => void;
  readonly dependencies = new Set<SignalImpl<unknown>>();
  readonly runner: Subscriber;

  constructor(runFn: () => void) {
    this.runFn = runFn;
    this.runner = this.run.bind(this);
  }

  run() {
    for (const dep of this.dependencies) {
      dep.subscribers.delete(this.runner);
    }
    this.dependencies.clear();

    const prev = activeEffect;
    activeEffect = this;
    try {
      this.runFn();
    } finally {
      activeEffect = prev;
    }
  }
}

class SignalImpl<T> {
  private _value: T;
  readonly subscribers = new Set<Subscriber>();

  constructor(value: T) {
    this._value = value;
  }

  get value(): T {
    if (activeEffect) {
      this.subscribers.add(activeEffect.runner);
      activeEffect.dependencies.add(this);
    }
    return this._value;
  }

  set value(next: T) {
    if (Object.is(this._value, next)) {
      return;
    }
    this._value = next;
    for (const sub of this.subscribers) {
      queueSubscriber(sub);
    }
  }

  peek(): T {
    return this._value;
  }
}

function queueSubscriber(sub: Subscriber) {
  if (batchDepth > 0) {
    pendingSubscribers.add(sub);
    return;
  }
  sub();
}

function flushSubscribers() {
  const tasks = Array.from(pendingSubscribers);
  pendingSubscribers.clear();
  for (const task of tasks) {
    task();
  }
}

export type Signal<T> = {
  value: T;
  peek: () => T;
};

export type ReadonlySignal<T> = {
  readonly value: T;
  peek: () => T;
};

export function signal<T>(value: T): Signal<T> {
  return new SignalImpl(value);
}

export function effect(run: () => void): Unsubscribe {
  const reactive = new ReactiveEffect(run);
  reactive.runner();
  return () => {
    for (const dep of reactive.dependencies) {
      dep.subscribers.delete(reactive.runner);
    }
    reactive.dependencies.clear();
  };
}

export function computed<T>(run: () => T): ReadonlySignal<T> {
  const out = signal(run());
  effect(() => {
    out.value = run();
  });
  return {
    get value() {
      return out.value;
    },
    peek: () => out.peek(),
  };
}

export function batch(run: () => void) {
  batchDepth += 1;
  try {
    run();
  } finally {
    batchDepth -= 1;
    if (batchDepth === 0) {
      flushSubscribers();
    }
  }
}

export function untracked<T>(run: () => T): T {
  const prev = activeEffect;
  activeEffect = null;
  try {
    return run();
  } finally {
    activeEffect = prev;
  }
}

export function namedSignals<T extends Record<string, unknown>>(
  config: T,
): { [K in keyof T]: Signal<T[K]> } {
  const output = {} as { [K in keyof T]: Signal<T[K]> };
  for (const [key, value] of Object.entries(config)) {
    (output as Record<string, Signal<unknown>>)[key] = signal(value);
  }
  return output;
}

export function watchedSignal<T>(
  getCurrentValue: () => T,
  watch: (setSignal: Signal<T>) => Unsubscribe,
): Signal<T> {
  const watched = signal(getCurrentValue());
  watch(watched);
  return watched;
}
