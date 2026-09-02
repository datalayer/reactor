/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Keybindings: written once, correct on every platform.
 *
 * A command declares `keybinding: 'Mod+K'` and gets ⌘K on a Mac and Ctrl+K
 * everywhere else — both when the keystroke is matched and when it is drawn.
 * Writing the two separately is how a shortcut ends up displayed as ⌘K on a
 * Mac while still only firing on Ctrl.
 *
 * The vocabulary is the one editors already use, so it is guessable:
 *
 * | modifier | means |
 * | --- | --- |
 * | `Mod` | ⌘ on Apple platforms, Ctrl everywhere else |
 * | `Ctrl` | Ctrl, on every platform |
 * | `Alt` | Alt, or ⌥ |
 * | `Shift` | Shift |
 * | `Meta` | ⌘ / the Windows key, on every platform |
 *
 * `Mod` is the one to reach for. `Ctrl` is for a binding that must be Ctrl even
 * on a Mac — rare, and usually a mistake.
 *
 * Chords are `+`-separated and order-insensitive: `Ctrl+Alt+Z` and
 * `Alt+Ctrl+Z` are the same binding. The final segment is the key itself,
 * matched against `KeyboardEvent.key` case-insensitively so `Mod+K` fires
 * whether or not Shift is physically down — except when the binding asks for
 * Shift, which is then required.
 *
 * @module core/keys
 */

/** A keystroke, as a plugin writes it: `'Mod+K'`, `'Ctrl+Alt+Z'`. */
export type Keybinding = string;

/** A binding taken apart, ready to match against an event. */
export type ParsedKeybinding = {
  /** The key itself, lowercased when it is a single character. */
  key: string;
  /** ⌘ on Apple, Ctrl elsewhere. */
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
};

/**
 * Whether this is an Apple platform, for choosing ⌘ over Ctrl.
 *
 * `navigator.platform` is deprecated and `userAgentData` is not everywhere, so
 * both are consulted and neither is required: a wrong answer here costs a
 * modifier, not a crash. Server-side it answers `false`, which is also what a
 * server should think about keyboards.
 */
export function isApplePlatform(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const data = (navigator as { userAgentData?: { platform?: string } })
    .userAgentData;
  const platform = data?.platform ?? navigator.platform ?? '';
  const agent = navigator.userAgent ?? '';
  return /mac|iphone|ipad|ipod/i.test(`${platform} ${agent}`);
}

/** Modifier names, by the spelling a plugin may use. */
const MODIFIERS: Record<string, keyof Omit<ParsedKeybinding, 'key'>> = {
  mod: 'mod',
  cmdorctrl: 'mod',
  commandorcontrol: 'mod',
  ctrl: 'ctrl',
  control: 'ctrl',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
  super: 'meta',
  win: 'meta',
  alt: 'alt',
  option: 'alt',
  opt: 'alt',
  shift: 'shift',
};

/** How a key is spelled in a binding, versus in `KeyboardEvent.key`. */
const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  del: 'delete',
  ins: 'insert',
  space: ' ',
  spacebar: ' ',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  plus: '+',
  return: 'enter',
};

/**
 * Take a binding apart.
 *
 * Returns `null` for anything unparseable — an empty string, modifiers with no
 * key — rather than throwing: a plugin with a malformed shortcut should lose
 * the shortcut, not stop the application from starting.
 */
export function parseKeybinding(binding: Keybinding): ParsedKeybinding | null {
  if (!binding) {
    return null;
  }
  const parsed: ParsedKeybinding = {
    key: '',
    mod: false,
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
  };

  // `+` is both the separator and a legal key, so a trailing one is the key.
  const segments = binding
    .split('+')
    .map(segment => segment.trim())
    .filter((segment, index, all) => segment !== '' || index === all.length - 1);

  for (const [index, segment] of segments.entries()) {
    const lower = segment.toLowerCase();
    const modifier = MODIFIERS[lower];
    if (modifier && index < segments.length - 1) {
      parsed[modifier] = true;
      continue;
    }
    // The last segment is the key, even when it is spelled like a modifier —
    // `Mod+Shift` alone is not a binding anybody meant.
    const key = segment === '' ? '+' : (KEY_ALIASES[lower] ?? lower);
    parsed.key = key;
  }

  return parsed.key ? parsed : null;
}

/** Whether an event is this binding being pressed. */
export function matchesKeybinding(
  event: KeyboardEvent,
  binding: ParsedKeybinding,
  apple: boolean = isApplePlatform(),
): boolean {
  const key = event.key?.toLowerCase() ?? '';
  if (key !== binding.key) {
    return false;
  }

  // `Mod` resolves to one real modifier, and the *other* one must then be
  // absent: on a Mac, Ctrl+K is not ⌘K and should reach whatever else wants it.
  const wantsCtrl = binding.ctrl || (binding.mod && !apple);
  const wantsMeta = binding.meta || (binding.mod && apple);

  return (
    event.ctrlKey === wantsCtrl &&
    event.metaKey === wantsMeta &&
    event.altKey === binding.alt &&
    event.shiftKey === binding.shift
  );
}

/** What each modifier looks like, per platform. */
const APPLE_SYMBOLS = { ctrl: '⌃', meta: '⌘', alt: '⌥', shift: '⇧' };
const OTHER_LABELS = { ctrl: 'Ctrl', meta: 'Meta', alt: 'Alt', shift: 'Shift' };

/** How a key reads when it is not a single character. */
const KEY_LABELS: Record<string, string> = {
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  enter: '↵',
  escape: 'Esc',
  ' ': 'Space',
  backspace: '⌫',
  delete: 'Del',
  tab: '⇥',
};

/**
 * Draw a binding the way this platform writes it.
 *
 * ⌘⇧P on a Mac, Ctrl+Shift+P elsewhere — including the ordering, which is
 * conventional rather than arbitrary: Apple's is ⌃⌥⇧⌘, everyone else's puts
 * Ctrl first.
 *
 * Returns the input unchanged if it cannot be parsed, so a surface showing a
 * malformed binding shows what was written rather than nothing.
 */
export function formatKeybinding(
  binding: Keybinding,
  apple: boolean = isApplePlatform(),
): string {
  const parsed = parseKeybinding(binding);
  if (!parsed) {
    return binding;
  }

  const ctrl = parsed.ctrl || (parsed.mod && !apple);
  const meta = parsed.meta || (parsed.mod && apple);
  const key = KEY_LABELS[parsed.key] ?? (
    parsed.key.length === 1 ? parsed.key.toUpperCase() : titleCase(parsed.key)
  );

  if (apple) {
    // Apple's own order, which people read as one glyph rather than a list.
    return [
      parsed.ctrl ? APPLE_SYMBOLS.ctrl : '',
      parsed.alt ? APPLE_SYMBOLS.alt : '',
      parsed.shift ? APPLE_SYMBOLS.shift : '',
      meta ? APPLE_SYMBOLS.meta : '',
      key,
    ].join('');
  }

  return [
    ctrl ? OTHER_LABELS.ctrl : '',
    meta && !ctrl ? OTHER_LABELS.meta : '',
    parsed.alt ? OTHER_LABELS.alt : '',
    parsed.shift ? OTHER_LABELS.shift : '',
    key,
  ]
    .filter(Boolean)
    .join('+');
}

function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
