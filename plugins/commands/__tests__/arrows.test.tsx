/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * @vitest-environment jsdom
 */

/**
 * Moving through the list, including while filtering it.
 *
 * ↑↓ worked on an empty field and stopped the moment somebody typed. The
 * handler was fine — jsdom moves the selection either way — because the list
 * being walked was the *browser's* autofill dropdown, which a plain text input
 * offers once it has a value it recognises. Nothing here is a form field.
 */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { buildReactorFromPlugins, definePlugin } from '../../../src/index';
import { registerReactor } from '../../../src/react';
import { CommandPalette, CommandsPlugin } from '../src/index';

const Many = definePlugin({
  name: '@tests/many',
  commands: [
    { id: 'a.one', name: 'Alpha one', execute: () => {} },
    { id: 'a.two', name: 'Alpha two', execute: () => {} },
    { id: 'a.three', name: 'Alpha three', execute: () => {} },
    { id: 'b.other', name: 'Beta', execute: () => {} },
  ],
});

/** The name of the option currently marked selected. */
function selectedLabel(): string | null {
  return (
    document.querySelector('[aria-selected="true"] .dla-cmdk-name')
      ?.textContent ?? null
  );
}

async function openPalette() {
  const reactor = buildReactorFromPlugins([CommandsPlugin, Many]);
  reactor.start();
  registerReactor(reactor);

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<CommandPalette />);
  });
  await act(async () => {
    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'k',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
  return { root };
}

function input(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('.dla-cmdk-input')!;
}

/** Typing, the way React hears it. */
async function type(text: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )!.set!;
    setter.call(input(), text);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function press(key: string) {
  await act(async () => {
    input().dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  });
}

describe('moving through the commands', () => {
  it('moves with the arrows, and wraps', async () => {
    const { root } = await openPalette();

    const first = selectedLabel();
    await press('ArrowDown');
    expect(selectedLabel()).not.toBe(first);

    await press('ArrowUp');
    expect(selectedLabel()).toBe(first);

    await act(async () => root.unmount());
  });

  it('still moves once the list has been filtered', async () => {
    const { root } = await openPalette();
    await type('alpha');

    expect(selectedLabel()).toBe('Alpha one');
    await press('ArrowDown');
    expect(selectedLabel()).toBe('Alpha two');
    await press('ArrowDown');
    expect(selectedLabel()).toBe('Alpha three');

    await act(async () => root.unmount());
  });

  it('asks the browser not to offer its own list over the top', async () => {
    const { root } = await openPalette();

    // The autofill dropdown is what ↑↓ were reaching instead of the commands.
    expect(input().getAttribute('autocomplete')).toBe('off');
    // And says what the field actually drives, so it is treated as a widget.
    expect(input().getAttribute('role')).toBe('combobox');
    expect(input().getAttribute('aria-controls')).toBe('dla-cmdk-list');

    await root.unmount();
  });

  it('tells a screen reader which option is current', async () => {
    const { root } = await openPalette();
    await type('alpha');
    await press('ArrowDown');

    const active = input().getAttribute('aria-activedescendant');
    expect(active).not.toBeNull();
    expect(document.getElementById(active!)?.textContent).toContain('Alpha two');

    await act(async () => root.unmount());
  });
});
