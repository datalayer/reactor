/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The command palette.
 *
 * Ctrl-K (⌘K on a Mac) opens a floating bar over the application; typing
 * filters every command plugins have registered; Enter runs the one selected.
 *
 * The plugin owns none of the commands it shows. It reads the reactor's command
 * registry, which is where they already live — so a plugin gets a palette entry
 * by registering a command, not by knowing this plugin exists. That is the same
 * split the graph plugin has: the framework derives the data, the plugin draws
 * it, and neither imports the other.
 *
 * Two deliberate constraints, both about being usable in *any* host:
 *
 * - **No design system.** The music example is Primer and the CMS example is
 *   Tailwind; a palette that imported either would be unusable in the other, and
 *   dragging a second CSS baseline into a host is how a plugin breaks the
 *   application it was added to. Everything here is scoped inline style driven
 *   by CSS custom properties, so a host restyles it by setting variables and
 *   nothing leaks either way.
 * - **Portalled to the document root.** A floating bar rendered inside a host's
 *   layout inherits that layout's stacking and overflow, and a palette clipped
 *   by a sidebar is not a palette.
 *
 * @module commands-plugin
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  definePlugin,
  formatKeybinding,
  isApplePlatform,
  matchesKeybinding,
  parseKeybinding,
  type ParsedKeybinding,
  type RegisteredCommand,
} from '@datalayer/reactor';
import { useCommands, useReactorPlatform } from '@datalayer/reactor/react';

/**
 * The palette's looks, as variables a host can override.
 *
 * Set any of these on `:root` (or on an ancestor of the portal) and the palette
 * follows. The fallbacks are a neutral light/dark pair, so a host that sets
 * nothing still gets something legible.
 */
const STYLE_ELEMENT_ID = 'datalayer-reactor-commands-style';

const PALETTE_CSS = `
/*
 * Colours live on the panel as variables with light defaults, and the dark
 * values are applied by whichever signal the host actually uses:
 *
 *   [data-color-mode]  Primer, set by setupPrimerPortals on the portal root
 *                      this palette renders into — so it follows the app's
 *                      colormode rather than the operating system's.
 *   [data-theme], .dark  the two conventions a Tailwind host is likely to use.
 *   prefers-color-scheme  the fallback when a host declares nothing.
 *
 * An explicit light setting has to beat the media query, which is why the
 * fallback is written as "not explicitly light" rather than a bare media rule.
 */
.dla-cmdk-panel {
  --cmdk-bg: var(--dla-cmdk-bg, #ffffff);
  --cmdk-fg: var(--dla-cmdk-fg, #1f2328);
  --cmdk-border: var(--dla-cmdk-border, rgba(0, 0, 0, 0.12));
  --cmdk-selected: var(--dla-cmdk-selected, rgba(0, 0, 0, 0.06));
  --cmdk-error-fg: var(--dla-cmdk-error-fg, #d1242f);
  --cmdk-error-bg: var(--dla-cmdk-error-bg, rgba(209, 36, 47, 0.08));
}
[data-color-mode='dark'] .dla-cmdk-panel,
[data-theme='dark'] .dla-cmdk-panel,
.dark .dla-cmdk-panel {
  --cmdk-bg: var(--dla-cmdk-bg, #1c2128);
  --cmdk-fg: var(--dla-cmdk-fg, #e6edf3);
  --cmdk-border: var(--dla-cmdk-border, rgba(255, 255, 255, 0.14));
  --cmdk-selected: var(--dla-cmdk-selected, rgba(255, 255, 255, 0.08));
  --cmdk-error-fg: var(--dla-cmdk-error-fg, #ff7b72);
  --cmdk-error-bg: var(--dla-cmdk-error-bg, rgba(248, 81, 73, 0.12));
}
@media (prefers-color-scheme: dark) {
  :not([data-color-mode='light']):not([data-theme='light']) > .dla-cmdk-backdrop
    .dla-cmdk-panel {
    --cmdk-bg: var(--dla-cmdk-bg, #1c2128);
    --cmdk-fg: var(--dla-cmdk-fg, #e6edf3);
    --cmdk-border: var(--dla-cmdk-border, rgba(255, 255, 255, 0.14));
    --cmdk-selected: var(--dla-cmdk-selected, rgba(255, 255, 255, 0.08));
    --cmdk-error-fg: var(--dla-cmdk-error-fg, #ff7b72);
    --cmdk-error-bg: var(--dla-cmdk-error-bg, rgba(248, 81, 73, 0.12));
  }
}

.dla-cmdk-backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--dla-cmdk-z, 1000);
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
  background: var(--dla-cmdk-backdrop, rgba(0, 0, 0, 0.4));
}
.dla-cmdk-panel {
  width: min(640px, calc(100vw - 32px));
  max-height: 60vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: var(--dla-cmdk-radius, 12px);
  background: var(--cmdk-bg);
  color: var(--cmdk-fg);
  border: 1px solid var(--cmdk-border);
  box-shadow: var(--dla-cmdk-shadow, 0 16px 48px rgba(0, 0, 0, 0.24));
  font-family: var(--dla-cmdk-font, system-ui, -apple-system, "Segoe UI", sans-serif);
}
.dla-cmdk-search {
  padding: 12px;
  border-bottom: 1px solid var(--cmdk-border);
}
.dla-cmdk-input {
  width: 100%;
  box-sizing: border-box;
  padding: 8px 10px;
  font: inherit;
  font-size: 15px;
  color: inherit;
  background: var(--dla-cmdk-input-bg, transparent);
  border: 1px solid var(--cmdk-border);
  border-radius: var(--dla-cmdk-input-radius, 8px);
  outline: none;
}
.dla-cmdk-input:focus {
  border-color: var(--dla-cmdk-accent, #0969da);
}
.dla-cmdk-list {
  overflow-y: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}
.dla-cmdk-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  cursor: pointer;
  border: 0;
  width: 100%;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
}
.dla-cmdk-item[aria-selected='true'] {
  background: var(--cmdk-selected);
}
.dla-cmdk-item[aria-disabled='true'] {
  opacity: 0.5;
  cursor: not-allowed;
}
.dla-cmdk-mark {
  width: 20px;
  text-align: center;
  font-size: 15px;
  flex: none;
}
.dla-cmdk-text { flex: 1; min-width: 0; }
.dla-cmdk-name { font-weight: 600; font-size: 14px; }
.dla-cmdk-description {
  font-size: 12px;
  opacity: 0.7;
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dla-cmdk-meta { font-size: 12px; opacity: 0.6; flex: none; }
.dla-cmdk-empty { padding: 20px 12px; font-size: 14px; opacity: 0.7; }
.dla-cmdk-error {
  padding: 10px 12px;
  font-size: 13px;
  color: var(--cmdk-error-fg);
  background: var(--cmdk-error-bg);
}
.dla-cmdk-footer {
  display: flex;
  justify-content: space-between;
  padding: 8px 12px;
  font-size: 12px;
  opacity: 0.6;
  border-top: 1px solid var(--cmdk-border);
}
`;

/**
 * Put the palette's stylesheet in the document, once.
 *
 * A `<style>` rather than an imported `.css` file so the plugin stays a plain
 * JavaScript module: a host bundling it needs no CSS loader configured, and a
 * remote plugin loaded at runtime has no stylesheet to fetch separately.
 */
function usePaletteStyles(): void {
  useEffect(() => {
    if (typeof document === 'undefined' || document.getElementById(STYLE_ELEMENT_ID)) {
      return;
    }
    const element = document.createElement('style');
    element.id = STYLE_ELEMENT_ID;
    element.textContent = PALETTE_CSS;
    document.head.appendChild(element);
    // Deliberately not removed on unmount: another palette instance may still
    // be using it, and a stylesheet that flickers with a component is worse
    // than one that outlives it.
  }, []);
}

/** How a command matches what somebody typed, and how well. */
type Match = {
  command: RegisteredCommand;
  score: number;
};

/**
 * Rank a command against a query.
 *
 * Deliberately simple — substring matching over the text a person can see, with
 * name matches beating id, category and description ones, and earlier matches
 * beating later. A fuzzy matcher would be a dependency and a tuning problem,
 * and a palette over a few dozen commands does not need one.
 *
 * Returns `null` when the command does not match at all.
 */
function rank(command: RegisteredCommand, query: string): Match | null {
  if (!query) {
    return { command, score: 0 };
  }
  const needle = query.toLowerCase();
  const fields: [string, number][] = [
    [command.name.toLowerCase(), 0],
    [command.id.toLowerCase(), 100],
    [(command.category ?? '').toLowerCase(), 200],
    [(command.description ?? '').toLowerCase(), 300],
  ];
  for (const [haystack, base] of fields) {
    const at = haystack.indexOf(needle);
    if (at >= 0) {
      return { command, score: base + at };
    }
  }
  return null;
}

/**
 * Where the palette mounts.
 *
 * A Primer host calls `setupPrimerPortals` from `@datalayer/primer-addons`,
 * which creates this element and keeps `data-color-mode` on it in step with the
 * application's colormode. Rendering inside it is what makes the palette follow
 * a *toggled* dark mode rather than only the operating system's — a dialog that
 * stays light while the application is dark is the visible symptom of being
 * portalled to a `body` nobody themed.
 *
 * Looked up by id rather than imported, so this plugin still owes Primer
 * nothing: a host without it gets `body`, and the media query below.
 */
const PRIMER_PORTAL_ROOT_ID = '__primerPortalRoot__';

function paletteRoot(): HTMLElement {
  return document.getElementById(PRIMER_PORTAL_ROOT_ID) ?? document.body;
}

/** What opens the palette. Declared once, matched and drawn from the same string. */
export const PALETTE_KEYBINDING = 'Mod+K';

const PALETTE_CHORD = parseKeybinding(PALETTE_KEYBINDING);

/**
 * The floating bar.
 *
 * Mounted always and rendered only when open, so the keyboard listener has one
 * owner, and every open starts from an empty query — which is what a palette
 * should do.
 */
export function CommandPalette(): React.JSX.Element | null {
  const reactor = useReactorPlatform();
  const commands = useCommands();
  usePaletteStyles();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const matches = useMemo(
    () =>
      commands
        .map((command) => rank(command, query))
        .filter((match): match is Match => match !== null)
        .sort((a, b) => a.score - b.score)
        .map((match) => match.command),
    [commands, query],
  );

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setSelected(0);
    setError(null);
  }, []);

  const run = useCallback(
    async (command: RegisteredCommand) => {
      setRunning(command.id);
      setError(null);
      try {
        await reactor.executeCommand(command.id);
        close();
      } catch (failure) {
        // The palette is where the person is looking, so it is where the
        // failure belongs. Staying open also keeps their query, so a command
        // that failed for a fixable reason can be retried.
        setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        setRunning(null);
      }
    },
    [close, reactor],
  );

  /*
   * The one global listener: opens the palette, and closes it on Escape.
   *
   * Registered on the **capture** phase of `document`, which is what makes the
   * shortcut reliable rather than merely declared:
   *
   * - Chrome's own Ctrl-K ("Search Google") is a *default action*, and a page
   *   may override it — but only if something calls `preventDefault`. A
   *   bubble-phase listener on `window` never gets the chance when a
   *   descendant stops propagation first, and the editors in a workspace do
   *   exactly that: Lexical in the prompt and CodeMirror in the notebook both
   *   handle keydown and stop it. The palette then looked broken in precisely
   *   the place people were typing, which is the only place it matters.
   * - CodeMirror also binds Ctrl-K itself (delete-to-end-of-line, from the
   *   emacs-flavoured keymap). Capturing means the palette wins that too, and
   *   `stopPropagation` is what stops the editor acting on the same keystroke
   *   behind the open palette.
   *
   * Escape is deliberately *not* captured: an editor with its own idea of
   * Escape should keep it, and the palette only needs the ones that reach it.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (isPaletteShortcut(event)) {
        event.preventDefault();
        event.stopPropagation();
        setOpen((wasOpen) => !wasOpen);
        return;
      }
      if (event.key === 'Escape') {
        setOpen((wasOpen) => wasOpen && false);
      }
    }
    document.addEventListener('keydown', onKeyDown, { capture: true });
    return () =>
      document.removeEventListener('keydown', onKeyDown, { capture: true });
  }, []);

  // Opening focuses the input; every open starts from a clean query.
  useEffect(() => {
    if (!open) {
      return undefined;
    }
    setQuery('');
    setSelected(0);
    setError(null);
    // After paint, or the input is not in the document yet.
    const frame = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open]);

  // Keep the selection inside the list as it narrows.
  useEffect(() => {
    setSelected((current) => (current >= matches.length ? 0 : current));
  }, [matches.length]);

  if (!open || typeof document === 'undefined') {
    return null;
  }

  const onInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelected((current) => (matches.length === 0 ? 0 : (current + 1) % matches.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelected((current) =>
        matches.length === 0 ? 0 : (current - 1 + matches.length) % matches.length,
      );
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const command = matches[selected];
      if (command && command.isEnabled?.() !== false) {
        void run(command);
      }
    }
  };

  const palette = (
    // The backdrop: a click anywhere outside the panel dismisses it.
    <div className="dla-cmdk-backdrop" onClick={close}>
      <div
        className="dla-cmdk-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        // Clicks inside the panel must not reach the backdrop.
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dla-cmdk-search">
          <input
            ref={inputRef}
            className="dla-cmdk-input"
            type="text"
            placeholder="Run a command…"
            aria-label="Search commands"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
          />
        </div>

        {error !== null && <div className="dla-cmdk-error">{error}</div>}

        <ul className="dla-cmdk-list">
          {matches.length === 0 ? (
            <li className="dla-cmdk-empty">
              {commands.length === 0
                ? 'No plugin has registered a command yet.'
                : `Nothing matches “${query}”.`}
            </li>
          ) : (
            matches.map((command, index) => {
              const available = command.isEnabled?.() !== false;
              return (
                <li key={command.id}>
                  <button
                    type="button"
                    className="dla-cmdk-item"
                    aria-selected={index === selected}
                    aria-disabled={!available}
                    disabled={!available}
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => void run(command)}
                  >
                    <span className="dla-cmdk-mark" aria-hidden="true">
                      {command.emoji ?? '·'}
                    </span>
                    <span className="dla-cmdk-text">
                      <span className="dla-cmdk-name">{command.name}</span>
                      {command.description && (
                        <p className="dla-cmdk-description">{command.description}</p>
                      )}
                    </span>
                    {running === command.id && <span className="dla-cmdk-meta">running…</span>}
                    {command.keybinding && (
                      <span className="dla-cmdk-meta">{command.keybinding}</span>
                    )}
                    {command.category && <span className="dla-cmdk-meta">{command.category}</span>}
                  </button>
                </li>
              );
            })
          )}
        </ul>

        <div className="dla-cmdk-footer">
          <span>↑↓ to move · ↵ to run · esc to close</span>
          <span>
            {matches.length} of {commands.length}
          </span>
        </div>
      </div>
    </div>
  );

  return createPortal(palette, paletteRoot());
}

export const CommandsPlugin = definePlugin({
  name: '@datalayer/reactor-commands',
  version: '1.0.0',
  displayName: 'Commands',
  description:
    'A command palette: Ctrl-K opens a floating search over every command plugins have registered.',
  octicon: 'command-palette',
  emoji: '⌘',
  build() {
    return {
      components: [
        {
          // `root` is the convention for plugins that need a mount point but
          // position themselves; the palette portals out of wherever it lands,
          // so it only needs somewhere to live.
          slot: 'root',
          id: 'command-palette',
          Component: CommandPalette,
        },
      ],
    };
  },
  commands: [
    {
      id: 'commands.showPalette',
      name: 'Show the command palette',
      description: 'The same thing Ctrl-K does — listed so it is discoverable',
      emoji: '⌘',
      category: 'Commands',
      keybinding: 'Ctrl+K',
      execute: () => {
        // Dispatching the shortcut rather than reaching into the component's
        // state keeps one way in, so there is no second path to keep working.
        //
        // On `document`, because that is where the listener is: an event
        // dispatched on `window` has only `window` in its propagation path, so
        // a capture listener on `document` would never see it.
        document.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
        );
      },
    },
  ],
});

export default CommandsPlugin;
