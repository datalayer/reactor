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
import { definePlugin as define } from '../../../src/index';
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

async function mount(extra: Parameters<typeof buildReactorFromPlugins>[0] = []) {
  // Registered before the first render rather than from an effect: the palette
  // reads the platform while rendering, and `useReactor` would only have set
  // it up afterwards.
  const reactor = buildReactorFromPlugins([CommandsPlugin, ...extra]);
  reactor.start();
  registerReactor(reactor);

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<Harness />);
  });
  return { container, root, reactor };
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

describe("a plugin's own shortcut", () => {
  it('fires the command, even from inside a greedy editor', async () => {
    const ran: string[] = [];
    const Bound = define({
      name: '@tests/bound',
      commands: [
        {
          id: 'tests.bound',
          name: 'Bound',
          // Mod is Ctrl here and ⌘ on a Mac, from the one declaration.
          keybinding: 'Mod+Alt+G',
          execute: () => {
            ran.push('bound');
          },
        },
      ],
    });

    const { container, root } = await mount([Bound]);
    const editor = container.querySelector('[data-testid="editor"]')!;

    await act(async () => {
      editor.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'g',
          ctrlKey: true,
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
    });

    expect(ran).toEqual(['bound']);
    // The palette stays shut: a shortcut is how you skip it.
    expect(isOpen()).toBe(false);

    await act(async () => root.unmount());
  });

  it('leaves a chord nobody bound alone', async () => {
    const { container, root } = await mount();
    const editor = container.querySelector('[data-testid="editor"]')!;

    let event!: KeyboardEvent;
    await act(async () => {
      event = new KeyboardEvent('keydown', {
        key: 'g',
        ctrlKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      });
      editor.dispatchEvent(event);
    });

    // Nothing claimed it, so whatever else wants it still gets it.
    expect(event.defaultPrevented).toBe(false);

    await act(async () => root.unmount());
  });
});
