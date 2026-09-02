/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * @vitest-environment jsdom
 */

/**
 * Ctrl-K reaches the palette, whatever is between it and the keyboard.
 *
 * The shortcut is the whole interface, and the two ways it breaks are both
 * invisible from the outside: a descendant that stops keydown propagating (a
 * text editor, every time), and the browser's own Ctrl-K taking the keystroke
 * because nothing called `preventDefault`. Both leave a palette that simply
 * does not open, in exactly the place people are typing.
 */

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { buildReactorFromPlugins } from '../../../src/index';
import { registerReactor } from '../../../src/react';
import { CommandPalette, CommandsPlugin } from '../src/index';

/** An editor that swallows keydown, as Lexical and CodeMirror both do. */
function GreedyEditor() {
  return (
    <input
      data-testid="editor"
      onKeyDown={event => event.stopPropagation()}
    />
  );
}

function Harness() {
  return (
    <>
      <GreedyEditor />
      <CommandPalette />
    </>
  );
}

async function mount() {
  // Registered before the first render rather than from an effect: the palette
  // reads the platform while rendering, and `useReactor` would only have set
  // it up afterwards.
  const reactor = buildReactorFromPlugins([CommandsPlugin]);
  reactor.start();
  registerReactor(reactor);

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Harness />);
  });
  return { container, root };
}

/** Whether the palette is on screen. */
function isOpen(): boolean {
  return Boolean(
    document.querySelector('[role="dialog"][aria-label="Command palette"]'),
  );
}

/** Ctrl-K as the browser delivers it, from a given target. */
function pressCtrlK(target: EventTarget): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: 'k',
    ctrlKey: true,
    bubbles: true,
    cancelable: true,
  });
  target.dispatchEvent(event);
  return event;
}

describe('the palette shortcut', () => {
  it('opens even when the focused editor stops propagation', async () => {
    const { container, root } = await mount();
    const editor = container.querySelector('[data-testid="editor"]')!;

    await act(async () => {
      pressCtrlK(editor);
    });

    // Captured on the way down, so the editor's `stopPropagation` on the way
    // up never gets to matter.
    expect(isOpen()).toBe(true);

    await act(async () => root.unmount());
  });

  it('claims the keystroke from the browser', async () => {
    const { container, root } = await mount();
    const editor = container.querySelector('[data-testid="editor"]')!;

    let event!: KeyboardEvent;
    await act(async () => {
      event = pressCtrlK(editor);
    });

    // Chrome's own Ctrl-K is a default action, and this is what overrides it.
    expect(event.defaultPrevented).toBe(true);

    await act(async () => root.unmount());
  });

  it('closes again on a second press', async () => {
    const { root } = await mount();

    await act(async () => {
      pressCtrlK(document);
    });
    expect(isOpen()).toBe(true);

    await act(async () => {
      pressCtrlK(document);
    });
    expect(isOpen()).toBe(false);

    await act(async () => root.unmount());
  });
});
