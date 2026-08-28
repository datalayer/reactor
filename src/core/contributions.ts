/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Extension points and contributions.
 *
 * A slot answers "render everything plugins put here". An extension point
 * answers a different question: "what do plugins *offer*, so the application can
 * choose?" — a set of views of which one is on screen, a set of commands of
 * which one is invoked, a set of mention namespaces resolved on demand.
 *
 * The reactor deliberately knows nothing about what a contribution means. It
 * stores typed records, keeps them ordered, hands them back, and disposes them
 * with the extension that contributed them. Deciding which one is active, or
 * whether one is currently allowed, belongs to the application.
 *
 * @module core/contributions
 */

import type { Dispose } from './extension';

/**
 * A named, typed extension point.
 *
 * The type parameter exists only to type the contributions; it is erased at
 * runtime, where a point is just its id.
 */
export type ExtensionPoint<T> = {
  readonly id: string;
  /** Phantom type carrier — never populated at runtime. */
  readonly __contribution?: T;
};

/**
 * Declare an extension point.
 *
 * ```ts
 * export const ViewType = defineExtensionPoint<ViewTypeContribution>('app.viewType');
 * ```
 */
export function defineExtensionPoint<T>(id: string): ExtensionPoint<T> {
  if (!id) {
    throw new Error('defineExtensionPoint: an extension point needs an id');
  }
  return { id };
}

/** Options accepted when contributing to a point. */
export type ContributeOptions = {
  /**
   * Stable identity of the contribution within its point, used by hosts that
   * activate one contribution among many (`<ReactorViewHost active="notebook">`).
   * Defaults to the contributing extension's name.
   */
  id?: string;
  /** Lower sorts first. Ties keep contribution order. Defaults to `0`. */
  order?: number;
};

/** A stored contribution, as handed back to the application. */
export type Contribution<T> = {
  /** Name of the extension that contributed it — for hosts, and for debugging. */
  extension: string;
  /** Identity within the point (see {@link ContributeOptions.id}). */
  id: string;
  order: number;
  value: T;
};

/**
 * A contribution declared up-front on an extension, rather than imperatively
 * during `register`. Resolved by the reactor in the register phase.
 */
export type ContributionRecord<T = unknown> = {
  point: ExtensionPoint<T>;
  value: T;
  options?: ContributeOptions;
};

/**
 * Declare a contribution for {@link ReactorExtension.contributes}.
 *
 * ```ts
 * defineExtension({
 *   name: '@app/notebook',
 *   contributes: [contribution(ViewType, { title: 'Notebook', load }, { id: 'notebook' })],
 * });
 * ```
 */
export function contribution<T>(
  point: ExtensionPoint<T>,
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
  private readonly byExtension = new Map<string, Set<Dispose>>();
  private seq = 0;

  /**
   * Store a contribution and return its disposer. The disposer is idempotent
   * and is also called automatically when the contributing extension stops.
   */
  add<T>(
    extensionName: string,
    point: ExtensionPoint<T>,
    value: T,
    options: ContributeOptions = {},
  ): Dispose {
    const entry: StoredContribution = {
      extension: extensionName,
      id: options.id ?? extensionName,
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
      this.byExtension.get(extensionName)?.delete(dispose);
    };

    const owned = this.byExtension.get(extensionName);
    if (owned) {
      owned.add(dispose);
    } else {
      this.byExtension.set(extensionName, new Set([dispose]));
    }

    return dispose;
  }

  /** Contributions for a point, ordered by `order` then registration order. */
  get<T>(point: ExtensionPoint<T>): Contribution<T>[] {
    const entries = this.byPoint.get(point.id);
    if (!entries || entries.length === 0) {
      return [];
    }
    return [...entries]
      .sort((a, b) => (a.order === b.order ? a.seq - b.seq : a.order - b.order))
      .map(({ extension, id, order, value }) => ({
        extension,
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
   * have no `ExtensionPoint` objects to look things up with, only ids.
   */
  describe(): { point: string; contributions: Contribution<unknown>[] }[] {
    return this.points().map((point) => ({
      point,
      contributions: (this.byPoint.get(point) ?? [])
        .slice()
        .sort((a, b) => (a.order === b.order ? a.seq - b.seq : a.order - b.order))
        .map(({ extension, id, order, value }) => ({ extension, id, order, value })),
    }));
  }

  /** Drop everything one extension contributed (on `disable`, `stop`). */
  disposeExtension(extensionName: string): void {
    const owned = this.byExtension.get(extensionName);
    if (!owned) {
      return;
    }
    // Copy: each dispose mutates the set it is iterated from.
    for (const dispose of [...owned]) {
      dispose();
    }
    this.byExtension.delete(extensionName);
  }
}
