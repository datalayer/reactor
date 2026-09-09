/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * `@datalayer/reactor-shell` — the shell plugin other plugins extend.
 *
 * A shell — a workspace, a store, a CMS — usually has one control whose
 * options come from everybody else: which editor, which panel, which mode.
 * This plugin is that control made generic. It owns:
 *
 * - a **view point** (its own by default, or one the host already has),
 * - a **segmented selector** that shows nothing until plugins contribute,
 * - a **choice store** commands can read and cycle from outside React,
 * - a **cycle command** in the reactor's registry, with a keystroke.
 *
 * What a chosen view *does* is the host's business: the plugin announces the
 * choice through a configurable `announce` callback and records it, and the
 * host wires the announcement to whatever hosts the views. The LOOP
 * workspace in `@datalayer/agent-runtimes` wires it to the chat's
 * surface-request channel; a simpler host can read the store directly.
 *
 * Grown out of the LOOP editor selector, generalised: the loop's shell
 * plugin is now a thin wrapper over this one.
 *
 * @module index
 */

import {
  defineContributionPoint,
  definePlugin,
  type ContributionPoint,
} from "@datalayer/reactor";
import type { ReactorReactOutput } from "@datalayer/reactor/react";
import { ViewSelector, type ShellViewDescriptor } from "./ViewSelector";
import {
  NONE_VIEW,
  chooseView,
  nextView,
  seedViewChoice,
  setViewAnnouncer,
  type ViewAnnouncer,
} from "./viewChoice";

export const SHELL_PLUGIN_NAME = "@datalayer/reactor-shell";

/**
 * The default view point, for a host with no point of its own.
 *
 * A host that already declared one — the loop's editor point predates this
 * plugin — passes it in `config.point` instead, and nothing has to move.
 */
export const ShellView =
  defineContributionPoint<ShellViewDescriptor>("reactor.shell.view");

export type ShellPluginConfig = {
  /** Where the views arrive. Defaults to {@link ShellView}. */
  point: ContributionPoint<unknown>;
  /**
   * How a contributed value reads as a {@link ShellViewDescriptor}.
   *
   * The default assumes the contribution *is* one — which it is when the
   * host uses {@link ShellView}. A host with its own richer contribution
   * type maps it here, and this is also where gating lives: `context` is
   * whatever the slot passes (the loop hands its workspace), so a view can
   * be disabled against live state.
   */
  describe: (value: unknown, context: unknown) => ShellViewDescriptor;
  /** The slot the selector renders into. */
  slot: string;
  /** The view the selector starts on. A preference, not a demand. */
  defaultView: string;
  /** Whether the selector is drawn at all. The store and command remain. */
  showSelector: boolean;
  /**
   * Whether the empty choice is offered at all. A workspace that shows a
   * conversation beside an optional editor wants it; an application whose
   * views are everything it shows does not — then the selector lists only
   * the views, appears only once there are two, and the cycle command wraps
   * among them.
   */
  allowNone: boolean;
  /** What the empty choice is called. */
  noneLabel: string;
  /** The selector's accessible name. */
  ariaLabel: string;
  /** Told of every choice; returns whether anyone was listening. */
  announce: ViewAnnouncer;
  /**
   * What the cycle command is called and says, for a host whose views are
   * something more specific than "views" — a workspace's editors, say. The
   * palette shows these; a host that leaves them alone gets the generic pair.
   */
  commandName: string;
  commandDescription: string;
  /** The cycle command's id in the reactor registry. */
  commandId: string;
  /** Its keystroke. Empty disables the binding. */
  keybinding: string;
};

const describeAsIs = (value: unknown): ShellViewDescriptor =>
  value as ShellViewDescriptor;

export const ShellPlugin = definePlugin<
  ShellPluginConfig,
  unknown,
  ReactorReactOutput
>({
  name: SHELL_PLUGIN_NAME,
  displayName: "Shell",
  description: "A view point, its selector, and the choice as a command.",
  octicon: "columns",
  emoji: "\u{1F4D1}",
  config: {
    point: ShellView,
    describe: describeAsIs,
    slot: "header",
    defaultView: NONE_VIEW,
    showSelector: true,
    allowNone: true,
    noneLabel: "None",
    ariaLabel: "View",
    announce: () => true,
    commandId: "shell.cycleView",
    commandName: "Switch the view",
    commandDescription: "Cycle through the contributed views, and none",
    keybinding: "Mod+Alt+E",
  },
  contributionPoints: [ShellView],
  register: ({ config, registerCommand }) => {
    const undoAnnouncer = setViewAnnouncer(config.announce);
    const undoCommand = registerCommand({
      id: config.commandId,
      name: config.commandName,
      description: config.commandDescription,
      emoji: "\u{1F4D1}",
      category: "Workspace",
      keybinding: config.keybinding || undefined,
      execute: () => {
        chooseView(nextView());
      },
    });
    return () => {
      undoAnnouncer();
      undoCommand();
    };
  },
  build: ({ config }) => {
    // The selector starts where the host starts. Seeded, not announced: the
    // host's own default is what actually opens the view.
    seedViewChoice(config.defaultView || NONE_VIEW);
    return {
      components: config.showSelector
        ? [
            {
              id: "view-selector",
              slot: config.slot,
              Component: (slotProps: Record<string, unknown>) => (
                <ViewSelector
                  point={config.point}
                  describe={config.describe}
                  context={slotProps}
                  noneLabel={config.noneLabel}
                  allowNone={config.allowNone}
                  ariaLabel={config.ariaLabel}
                />
              ),
            },
          ]
        : [],
    };
  },
});

export { ViewSelector, type ShellViewDescriptor } from "./ViewSelector";
export {
  NONE_VIEW,
  chooseView,
  getViewChoice,
  nextView,
  seedViewChoice,
  setViewAnnouncer,
  setViewOptions,
  subscribeViewChoice,
  type ViewAnnouncer,
} from "./viewChoice";
export default ShellPlugin;
