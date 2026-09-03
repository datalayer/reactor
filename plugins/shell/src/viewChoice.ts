/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Which view the shell's selector last asked for, shared with commands.
 *
 * The application owns the view actually on screen; this store holds only
 * the *request* — what was last chosen from the selector or the cycle
 * command — plus the options the selector last saw, so a command can cycle
 * through them from outside React. It deliberately does not try to mirror
 * the application's resolved state: the selector disables what cannot open,
 * which keeps request and reality from drifting far.
 *
 * The store is module state on purpose, exactly like a command registry: the
 * selector and the command are two faces of one choice, and neither should
 * need the other on screen to work.
 *
 * @module viewChoice
 */

/** The choice that means "none of them". */
export const NONE_VIEW = "none";

type ViewChoiceState = {
  /** What was last asked for: `'none'` or a view id. */
  viewId: string;
  /** View ids on offer, in display order. `'none'` is implicit and first. */
  options: readonly string[];
};

/**
 * Told that a view was chosen, before the choice is recorded.
 *
 * How the host application learns of a choice without the store knowing the
 * host: the loop workspace wires this to its surface-request channel. The
 * return value says whether anyone was listening — a command with nobody on
 * the other end should say so rather than appear to work.
 */
export type ViewAnnouncer = (viewId: string) => boolean;

let state: ViewChoiceState = { viewId: NONE_VIEW, options: [] };
let announcer: ViewAnnouncer = () => true;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of [...listeners]) {
    listener();
  }
}

/** The current request and options, for `useSyncExternalStore` and commands. */
export function getViewChoice(): ViewChoiceState {
  return state;
}

/** Subscribe to changes. Returns the unsubscribe. */
export function subscribeViewChoice(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Install the host's announcer. Returns what undoes it. */
export function setViewAnnouncer(next: ViewAnnouncer): () => void {
  const previous = announcer;
  announcer = next;
  return () => {
    announcer = previous;
  };
}

/**
 * What the selector has to offer, published each time the contributions
 * change — how the cycle command knows the views without React.
 */
export function setViewOptions(options: readonly string[]): void {
  if (
    options.length === state.options.length &&
    options.every((id, index) => id === state.options[index])
  ) {
    return;
  }
  state = { ...state, options };
  notify();
}

/**
 * Ask for a view — `'none'` closes whatever is open.
 *
 * @returns whether the host's announcer heard it.
 */
export function chooseView(viewId: string): boolean {
  state = { ...state, viewId };
  notify();
  return announcer(viewId);
}

/**
 * Start the store on a view without announcing it.
 *
 * For a plugin's build phase: the application's own default is what actually
 * opens the view when it mounts, and this only makes the selector agree with
 * it from the first paint.
 */
export function seedViewChoice(viewId: string): void {
  if (state.viewId === viewId) {
    return;
  }
  state = { ...state, viewId };
  notify();
}

/** The choice after the current one, wrapping through `'none'`. */
export function nextView(): string {
  const all = [NONE_VIEW, ...state.options];
  const index = all.indexOf(state.viewId);
  return all[(index + 1) % all.length];
}
