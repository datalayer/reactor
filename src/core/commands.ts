/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * The command registry.
 *
 * A command is a named thing a person can invoke: "Play a random song", "Clear
 * the playlist", "Publish this draft". Plugins register them; the application
 * decides how they are reached — a palette, a menu, a keybinding, a chat
 * prompt. The reactor stores them and runs them, and deliberately knows about
 * no surface at all.
 *
 * This is a registry rather than a contribution point, and the difference is
 * not cosmetic. A contribution is data the host reads and interprets; a command
 * is *behaviour the host invokes without interpreting it*. Every host would
 * otherwise reimplement the same three things — look one up by id, run it and
 * catch what it throws, drop the ones whose plugin went away — and they would
 * each get the error handling slightly wrong.
 *
 * The Python side mirrors this in `reactor.commands`, for the same reason the
 * contribution registry exists on both: the two halves of the reactor should
 * not disagree about what a plugin can offer.
 *
 * @module core/commands
 */

import type { Dispose } from './plugin';
import type { Keybinding } from './keys';

/**
 * Something a person can invoke.
 *
 * Presentation sits beside behaviour on purpose. A palette needs a label, an
 * icon and a description *before* anything runs, and a command that carries
 * only a function forces every surface to keep a parallel table of labels —
 * which then drifts from the commands themselves.
 *
 * The type parameter is the argument `execute` takes. Most commands take
 * nothing; one invoked from a context menu might take the thing clicked.
 */
export type ReactorCommand<A = void> = {
  /**
   * Stable, unique identity — `music.playRandom`, not "Play a random song".
   *
   * Namespaced by convention, because ids collide across plugins that never
   * heard of each other. Registering an id twice is refused rather than
   * silently overwritten: two plugins fighting over one id is a bug, and the
   * one that loses would otherwise fail invisibly.
   */
  id: string;
  /** What a person reads in a palette or a menu. */
  name: string;
  /** One line, shown beside the name where there is room for it. */
  description?: string;
  /**
   * An [Octicon](https://primer.style/foundations/icons) name, for surfaces
   * that draw icons — the same vocabulary plugins already use for themselves.
   */
  octicon?: string;
  /** For surfaces that would rather show an emoji, or have no icon set. */
  emoji?: string;
  /**
   * Groups related commands where a surface shows sections. Free text: the
   * reactor never interprets it.
   */
  category?: string;
  /**
   * A keystroke that invokes this command, written once for every platform.
   *
   * `'Mod+K'` is ⌘K on a Mac and Ctrl+K elsewhere, both when the keystroke is
   * matched and when it is drawn — see `core/keys`. Chords work: `'Ctrl+Alt+Z'`,
   * `'Mod+Shift+P'`.
   *
   * The registry still listens to no keyboard; a *surface* does. The command
   * palette binds every one of these while it is mounted, which is what makes
   * a shortcut arrive with the plugin that declared it and leave with it.
   */
  keybinding?: Keybinding;
  /** Lower sorts first among commands. Ties keep registration order. */
  order?: number;
  /**
   * Whether the command can run right now.
   *
   * Asked at read time, so a surface can grey out "Clear the playlist" while
   * the playlist is empty. Absent means always. A command that is unavailable
   * is still *listed*: hiding it makes the application look like it lost a
   * feature, and telling somebody why they cannot do something is more useful
   * than pretending it was never there.
   */
  isEnabled?: () => boolean;
  /** Do the thing. May be async; may throw — see {@link CommandRegistry.execute}. */
  execute: (argument: A) => void | Promise<void>;
};

/** A command as handed back to a host, with the plugin that registered it. */
export type RegisteredCommand<A = any> = ReactorCommand<A> & {
  /** Name of the plugin that registered it — for hosts, and for debugging. */
  plugin: string;
};

/** Stored form: the command, its owner, and its arrival order for tie-breaks. */
type StoredCommand = {
  plugin: string;
  seq: number;
  command: ReactorCommand<any>;
};

/**
 * What a host holds: commands registered by plugins, and a way to run them.
 *
 * One instance lives on the reactor. Plugins reach it through the phase context
 * rather than importing it, so a command is disposed with the plugin that
 * registered it without the plugin arranging anything.
 */
export class CommandRegistry {
  private readonly byId = new Map<string, StoredCommand>();
  private readonly byPlugin = new Map<string, Set<Dispose>>();
  private readonly listeners = new Set<() => void>();
  private seq = 0;

  /**
   * Register a command and return its disposer.
   *
   * The disposer is idempotent, and is also run when the registering plugin
   * stops — so the ordinary case needs no disposer at all.
   *
   * @throws if `id` is already registered. See {@link ReactorCommand.id}.
   */
  add<A>(pluginName: string, command: ReactorCommand<A>): Dispose {
    if (!command.id) {
      throw new Error('CommandRegistry.add: a command needs an id');
    }
    const existing = this.byId.get(command.id);
    if (existing) {
      throw new Error(
        `CommandRegistry.add: command '${command.id}' is already registered by ` +
          `plugin '${existing.plugin}'. Command ids must be unique; namespace ` +
          `them with the plugin they belong to.`,
      );
    }

    const entry: StoredCommand = {
      plugin: pluginName,
      seq: this.seq++,
      command: command as ReactorCommand<any>,
    };
    this.byId.set(command.id, entry);

    let disposed = false;
    const dispose: Dispose = () => {
      if (disposed) {
        return;
      }
      disposed = true;
      // Only if it is still *this* entry: a later registration of the same id
      // (after this one was disposed) must not be removed by a stale disposer.
      if (this.byId.get(command.id) === entry) {
        this.byId.delete(command.id);
      }
      this.byPlugin.get(pluginName)?.delete(dispose);
      this.notify();
    };

    const owned = this.byPlugin.get(pluginName);
    if (owned) {
      owned.add(dispose);
    } else {
      this.byPlugin.set(pluginName, new Set([dispose]));
    }

    this.notify();
    return dispose;
  }

  /** One command by id, or `undefined`. */
  get(id: string): RegisteredCommand | undefined {
    const entry = this.byId.get(id);
    return entry ? { ...entry.command, plugin: entry.plugin } : undefined;
  }

  /** Every command, ordered by `order` then registration order. */
  list(): RegisteredCommand[] {
    return [...this.byId.values()]
      .sort((a, b) => {
        const orderA = a.command.order ?? 0;
        const orderB = b.command.order ?? 0;
        return orderA === orderB ? a.seq - b.seq : orderA - orderB;
      })
      .map((entry) => ({ ...entry.command, plugin: entry.plugin }));
  }

  /**
   * Run a command by id.
   *
   * Always async, even for a synchronous command, so a caller never has to ask
   * which kind it invoked. A command that throws rejects here rather than
   * taking down the surface that invoked it — the caller decides what a failed
   * command looks like, because only it knows where to say so.
   *
   * @throws if no such command is registered, or if it is currently disabled.
   */
  async execute<A = void>(id: string, argument?: A): Promise<void> {
    const entry = this.byId.get(id);
    if (!entry) {
      throw new Error(`CommandRegistry.execute: no command '${id}' is registered`);
    }
    if (entry.command.isEnabled && !entry.command.isEnabled()) {
      throw new Error(`CommandRegistry.execute: command '${id}' is not available right now`);
    }
    await entry.command.execute(argument as never);
  }

  /**
   * Be told when the set of commands changes.
   *
   * Registration and disposal both wake subscribers; *running* a command does
   * not. Hosts that already follow the reactor's revision get this for free —
   * this exists for a surface holding the registry alone.
   */
  subscribe(listener: () => void): Dispose {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Drop every command one plugin registered (on `disable`, `stop`). */
  disposePlugin(pluginName: string): void {
    const owned = this.byPlugin.get(pluginName);
    if (!owned) {
      return;
    }
    // Copy: each dispose mutates the set it is iterated from.
    for (const dispose of [...owned]) {
      dispose();
    }
    this.byPlugin.delete(pluginName);
  }

  private notify(): void {
    for (const listener of [...this.listeners]) {
      listener();
    }
  }
}
