/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

import { describe, expect, it } from 'vitest';
import {
  formatKeybinding,
  matchesKeybinding,
  parseKeybinding,
} from '../../index';

/** A keystroke, as the browser reports it. */
function press(
  key: string,
  modifiers: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {},
): KeyboardEvent {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...modifiers,
  } as KeyboardEvent;
}

const APPLE = true;
const OTHER = false;

describe('parsing a binding', () => {
  it('reads a plain key', () => {
    expect(parseKeybinding('K')).toMatchObject({ key: 'k', mod: false });
  });

  it('reads modifiers in any order', () => {
    expect(parseKeybinding('Ctrl+Alt+Z')).toMatchObject({
      key: 'z',
      ctrl: true,
      alt: true,
    });
    expect(parseKeybinding('Alt+Ctrl+Z')).toMatchObject({
      key: 'z',
      ctrl: true,
      alt: true,
    });
  });

  it('accepts the spellings people actually write', () => {
    for (const binding of ['Cmd+K', 'Command+K', 'Meta+K']) {
      expect(parseKeybinding(binding)).toMatchObject({ meta: true, key: 'k' });
    }
    for (const binding of ['Alt+K', 'Option+K', 'Opt+K']) {
      expect(parseKeybinding(binding)).toMatchObject({ alt: true, key: 'k' });
    }
  });

  it('names the keys that are not single characters', () => {
    expect(parseKeybinding('Mod+Esc')?.key).toBe('escape');
    expect(parseKeybinding('Mod+Up')?.key).toBe('arrowup');
    expect(parseKeybinding('Mod+Space')?.key).toBe(' ');
  });

  it('treats a trailing + as the key', () => {
    // `+` is both the separator and a legal key.
    expect(parseKeybinding('Mod++')).toMatchObject({ mod: true, key: '+' });
  });

  it('returns null rather than throwing on nonsense', () => {
    // A plugin with a malformed shortcut should lose the shortcut, not stop
    // the application from starting.
    expect(parseKeybinding('')).toBeNull();
  });
});

describe('matching a keystroke', () => {
  it('resolves Mod to Cmd on Apple and Ctrl elsewhere', () => {
    const mod = parseKeybinding('Mod+K')!;

    expect(matchesKeybinding(press('k', { metaKey: true }), mod, APPLE)).toBe(true);
    expect(matchesKeybinding(press('k', { ctrlKey: true }), mod, APPLE)).toBe(false);

    expect(matchesKeybinding(press('k', { ctrlKey: true }), mod, OTHER)).toBe(true);
    expect(matchesKeybinding(press('k', { metaKey: true }), mod, OTHER)).toBe(false);
  });

  it('keeps Ctrl meaning Ctrl on a Mac', () => {
    // The escape hatch: a binding that must be Ctrl even where Mod is Cmd.
    const ctrl = parseKeybinding('Ctrl+K')!;
    expect(matchesKeybinding(press('k', { ctrlKey: true }), ctrl, APPLE)).toBe(true);
    expect(matchesKeybinding(press('k', { metaKey: true }), ctrl, APPLE)).toBe(false);
  });

  it('matches a chord exactly, and refuses a superset', () => {
    const chord = parseKeybinding('Ctrl+Alt+Z')!;

    expect(
      matchesKeybinding(press('z', { ctrlKey: true, altKey: true }), chord, OTHER),
    ).toBe(true);
    // Shift was not asked for, so Ctrl+Alt+Shift+Z belongs to something else.
    expect(
      matchesKeybinding(
        press('z', { ctrlKey: true, altKey: true, shiftKey: true }),
        chord,
        OTHER,
      ),
    ).toBe(false);
    expect(matchesKeybinding(press('z', { ctrlKey: true }), chord, OTHER)).toBe(false);
  });

  it('ignores the case the keyboard reports', () => {
    const chord = parseKeybinding('Mod+Shift+P')!;
    // Shift makes the browser report 'P'.
    expect(
      matchesKeybinding(press('P', { ctrlKey: true, shiftKey: true }), chord, OTHER),
    ).toBe(true);
  });
});

describe('drawing a binding', () => {
  it('uses the symbols on Apple and words elsewhere', () => {
    expect(formatKeybinding('Mod+K', APPLE)).toBe('⌘K');
    expect(formatKeybinding('Mod+K', OTHER)).toBe('Ctrl+K');
  });

  it('follows each platform’s conventional order', () => {
    // Apple's is ⌃⌥⇧⌘; everyone else puts Ctrl first.
    expect(formatKeybinding('Mod+Shift+Alt+P', APPLE)).toBe('⌥⇧⌘P');
    expect(formatKeybinding('Mod+Shift+Alt+P', OTHER)).toBe('Ctrl+Alt+Shift+P');
  });

  it('names the keys a symbol reads better than a word', () => {
    expect(formatKeybinding('Mod+Up', APPLE)).toBe('⌘↑');
    expect(formatKeybinding('Mod+Enter', OTHER)).toBe('Ctrl+↵');
    expect(formatKeybinding('Esc', OTHER)).toBe('Esc');
  });

  it('gives back what it was given when it cannot parse it', () => {
    // A surface showing a malformed binding should show what was written
    // rather than nothing at all.
    expect(formatKeybinding('', OTHER)).toBe('');
  });
});
