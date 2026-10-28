/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

/**
 * The contributions as a table: for each contribution point, what the plugins
 * have put in it, drawn with Primer's `DataTable`.
 *
 * Generic like the rest of the manager: it reads the platform through the
 * Reactor API (`describeContributions`) and knows no point by name. A host
 * names the points to show (its own, so an empty one says *none* rather than
 * vanishing) or leaves them out for every point that holds something, and may
 * narrow the contributions to one plugin's.
 *
 * `ContributionsTable` is the component; `contributionsTablePlugin(options)`
 * contributes it to a component slot (`contributions-table` by default), so a
 * host draws it with `<ReactorSlot slot="contributions-table" />`. Both follow
 * the platform's revision, so the table changes as plugins are enabled and
 * disabled.
 */

import type { JSX } from 'react';
import { useMemo, useSyncExternalStore } from 'react';
import { DataTable, Table } from '@primer/react/experimental';
import { definePlugin, type Contribution } from '@datalayer/reactor';
import { useReactorPlatform } from '@datalayer/reactor/react';

/** One contribution in a row: its id and the plugin that made it. */
export interface ContributionsTableEntry {
  readonly id: string;
  readonly plugin: string;
}

/** What a point's row shows. */
export interface ContributionsTableRow {
  /** The point's id, which is also the row's. */
  readonly id: string;
  /** What the host calls the point, beside its id; absent when not named. */
  readonly label?: string;
  readonly contributions: readonly ContributionsTableEntry[];
}

/** How the table chooses its points and contributions. */
export interface ContributionsTableOptions {
  /**
   * The points to show, in this order, by id or as the points themselves:
   * every one gets a row, empty or not. Absent, every point that holds
   * something, in the platform's order.
   */
  readonly points?: readonly (string | { readonly id: string })[];
  /** Only the contributions of this plugin; every plugin's when absent. */
  readonly plugin?: string;
  /** A name for some points (`commands`, `functions`), shown beside the id. */
  readonly labels?: Readonly<Record<string, string>>;
  /** The table's title; *Contributions* by default. */
  readonly title?: string;
  /** Under the title: what the table is for. */
  readonly subtitle?: string;
}

/** The rows a table shows for a platform's contributions: pure, so a test reads it without React. */
export function contributionsTableRows(
  described: readonly { point: string; contributions: readonly Contribution<unknown>[] }[],
  options: ContributionsTableOptions = {},
): ContributionsTableRow[] {
  const byPoint = new Map(described.map((entry) => [entry.point, entry.contributions]));
  const points =
    options.points?.map((point) => (typeof point === 'string' ? point : point.id)) ??
    described.map((entry) => entry.point);
  return points.map((id) => ({
    id,
    ...(options.labels?.[id] !== undefined ? { label: options.labels[id] } : {}),
    contributions: (byPoint.get(id) ?? [])
      .filter((c) => options.plugin === undefined || c.plugin === options.plugin)
      .map((c) => ({ id: c.id, plugin: c.plugin })),
  }));
}

/** The contribution points, in a Primer table with what each holds. */
export function ContributionsTable(options: ContributionsTableOptions): JSX.Element {
  const platform = useReactorPlatform();
  const revision = useSyncExternalStore(platform.subscribe, () => platform.getRevision());
  const rows = useMemo(
    () => contributionsTableRows(platform.describeContributions(), options),
    // `revision` is the snapshot: what the platform describes changes with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [platform, revision, options],
  );
  const title = options.title ?? 'Contributions';
  const titleId = 'reactor-contributions-table-title';
  return (
    <Table.Container>
      <Table.Title as="h3" id={titleId}>
        {title} ({rows.length})
      </Table.Title>
      {options.subtitle !== undefined && (
        <Table.Subtitle as="p" id={`${titleId}-subtitle`}>
          {options.subtitle}
        </Table.Subtitle>
      )}
      <DataTable
        aria-labelledby={titleId}
        aria-describedby={options.subtitle !== undefined ? `${titleId}-subtitle` : undefined}
        data={rows}
        columns={[
          {
            header: 'Point',
            field: 'id',
            rowHeader: true,
            renderCell: (row) => (
              <span>
                <code data-point={row.id}>{row.id}</code>
                {row.label !== undefined && <> ({row.label})</>}
              </span>
            ),
          },
          {
            header:
              options.plugin !== undefined ? `Contributed by ${options.plugin}` : 'Contributions',
            id: 'contributions',
            renderCell: (row) =>
              row.contributions.length === 0 ? (
                <span data-contributions="">none</span>
              ) : (
                <span data-contributions="">
                  {row.contributions
                    .map((c) => (options.plugin === undefined ? `${c.id} (${c.plugin})` : c.id))
                    .join(', ')}
                </span>
              ),
          },
        ]}
      />
    </Table.Container>
  );
}

/** The slot the table is contributed to by `contributionsTablePlugin`. */
export const CONTRIBUTIONS_TABLE_SLOT = 'contributions-table';

/**
 * A plugin that contributes `ContributionsTable`, configured, to a component
 * slot: the host draws it with `<ReactorSlot slot="contributions-table" />`.
 */
export function contributionsTablePlugin(
  options: ContributionsTableOptions & { readonly slot?: string } = {},
) {
  const { slot = CONTRIBUTIONS_TABLE_SLOT, ...table } = options;
  const Component = () => <ContributionsTable {...table} />;
  return definePlugin({
    name: '@datalayer/reactor-contributions-table',
    version: '1.0.0',
    displayName: 'Contributions table',
    description: 'The contribution points in a table: what the plugins put in each.',
    octicon: 'table',
    build() {
      return { components: [{ slot, id: 'contributions-table', Component }] };
    },
  });
}
