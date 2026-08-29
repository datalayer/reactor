/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Contribution points and contributions.
 *
 * A contribution point is provided by the reactor and defines a *type* of
 * functionality that can be extended; a contribution is the concrete thing a
 * plugin puts there. The two are the whole of declarative extensibility: one
 * plugin opens a point, others fill it, and neither imports the other.
 *
 * A slot answers "render everything plugins put here". A contribution point
 * answers a different question: "what do plugins *offer*, so the application
 * can choose?" — a set of views of which one is on screen, a set of commands
 * of which one is invoked, a set of mention namespaces resolved on demand.
 *
 * The reactor deliberately knows nothing about what a contribution means. It
 * stores typed records, keeps them ordered, hands them back, and disposes them
 * with the plugin that contributed them. Deciding which one is active, or
 * whether one is currently allowed, belongs to the application.
 *
 * @module core/contributions
 */

import type { Dispose } from './plugin';

/**
 * A named, typed contribution point.
 *
 * The type parameter exists only to type the contributions; it is erased at
 * runtime, where a point is just its id.
 */
export type ContributionPoint<T> = {
  readonly id: string;
  /** Phantom type carrier — never populated at runtime. */
  readonly __contribution?: T;
};

/**
 * Declare a contribution point.
 *
 * ```ts
 * export const ViewType = defineContributionPoint<ViewTypeContribution>('app.viewType');
 * ```
 */
export function defineContributionPoint<T>(id: string): ContributionPoint<T> {
  if (!id) {
    throw new Error('defineContributionPoint: a contribution point needs an id');
  }
  return { id };
}

/** Options accepted when contributing to a point. */
export type ContributeOptions = {
  /**
   * Stable identity of the contribution within its point, used by hosts that
   * activate one contribution among many (`<ReactorViewHost active="notebook">`).
   * Defaults to the contributing plugin's name.
   */
  id?: string;
  /** Lower sorts first. Ties keep contribution order. Defaults to `0`. */
  order?: number;
};

/** A stored contribution, as handed back to the application. */
export type Contribution<T> = {
  /** Name of the plugin that contributed it — for hosts, and for debugging. */
  plugin: string;
  /** Identity within the point (see {@link ContributeOptions.id}). */
  id: string;
  order: number;
  value: T;
};

/**
 * A contribution declared up-front on a plugin, rather than imperatively
 * during `register`. Resolved by the reactor in the register phase.
 */
export type ContributionRecord<T = unknown> = {
  point: ContributionPoint<T>;
  value: T;
  options?: ContributeOptions;
};

/**
 * Declare a contribution for {@link ReactorPlugin.contributes}.
 *
 * ```ts
 * definePlugin({
 *   name: '@app/notebook',
 *   contributes: [contribution(ViewType, { title: 'Notebook', load }, { id: 'notebook' })],
 * });
 * ```
 */
export function contribution<T>(
  point: ContributionPoint<T>,
  value: T,
  options?: ContributeOptions,
): ContributionRecord<T> {
  return { point, value, options };
}

type StoredContribution = Contribution<unknown> & {
  /** Monotonic sequence, so equal `order` keeps registration order. */
  seq: number;
};

/**
 * The registry behind a reactor platform. Internal: applications reach it
 * through `reactor.getContributions(point)` and `ctx.contribute(point, value)`.
 */
export class ContributionRegistry {
  private readonly byPoint = new Map<string, StoredContribution[]>();
  private readonly byPlugin = new Map<string, Set<Dispose>>();
  private seq = 0;

  /**
   * Store a contribution and return its disposer. The disposer is idempotent
   * and is also called automatically when the contributing plugin stops.
   */
  add<T>(
    pluginName: string,
    point: ContributionPoint<T>,
    value: T,
    options: ContributeOptions = {},
  ): Dispose {
    const entry: StoredContribution = {
      plugin: pluginName,
      id: options.id ?? pluginName,
      order: options.order ?? 0,
      value,
      seq: this.seq++,
    };

    const entries = this.byPoint.get(point.id);
    if (entries) {
      entries.push(entry);
    } else {
      this.byPoint.set(point.id, [entry]);
    }

    let disposed = false;
    const dispose: Dispose = () => {
      if (disposed) {
        return;
      }
      disposed = true;
      const current = this.byPoint.get(point.id);
      if (current) {
        const index = current.indexOf(entry);
        if (index >= 0) {
          current.splice(index, 1);
        }
        if (current.length === 0) {
          this.byPoint.delete(point.id);
        }
      }
      this.byPlugin.get(pluginName)?.delete(dispose);
    };

    const owned = this.byPlugin.get(pluginName);
    if (owned) {
      owned.add(dispose);
    } else {
      this.byPlugin.set(pluginName, new Set([dispose]));
    }

    return dispose;
  }

  /** Contributions for a point, ordered by `order` then registration order. */
  get<T>(point: ContributionPoint<T>): Contribution<T>[] {
    const entries = this.byPoint.get(point.id);
    if (!entries || entries.length === 0) {
      return [];
    }
    return [...entries]
      .sort((a, b) => (a.order === b.order ? a.seq - b.seq : a.order - b.order))
      .map(({ plugin, id, order, value }) => ({
        plugin,
        id,
        order,
        value: value as T,
      }));
  }

  /** Ids of the points that currently hold something. */
  points(): string[] {
    return [...this.byPoint.keys()].sort();
  }

  /**
   * Every point and what is currently contributed to it.
   *
   * For hosts that describe the whole graph rather than read one point — they
   * have no `ContributionPoint` objects to look things up with, only ids.
   */
  describe(): { point: string; contributions: Contribution<unknown>[] }[] {
    return this.points().map((point) => ({
      point,
      contributions: (this.byPoint.get(point) ?? [])
        .slice()
        .sort((a, b) => (a.order === b.order ? a.seq - b.seq : a.order - b.order))
        .map(({ plugin, id, order, value }) => ({ plugin, id, order, value })),
    }));
  }

  /** Drop everything one plugin contributed (on `disable`, `stop`). */
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
}
