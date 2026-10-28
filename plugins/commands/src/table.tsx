/*
 * Copyright (c) 2025-2026 Datalayer, Inc.
 * Distributed under the terms of the Modified BSD License.
 */

/**
 * The commands as a table: every command plugins have registered (or one
 * category of them), its id, its name and the keys it answers to, drawn with
 * Primer's `DataTable` and `KeybindingHint`.
 *
 * `CommandsTable` is the component; `commandsTablePlugin(options)` contributes
 * it to a component slot (`commands-table` by default), so a host draws it with
 * `<ReactorSlot slot="commands-table" />` and decides nothing else. Both read
 * the platform the host published (`useCommands`), so the table follows plugins
 * as they are enabled and disabled.
 */

import React, { useMemo } from 'react';
import { definePlugin, type RegisteredCommand } from '@datalayer/reactor';
import { useCommands } from '@datalayer/reactor/react';
import { DataTable, KeybindingHint, Table } from '@primer/react/experimental';

/** What a command's row shows. */
export interface CommandsTableRow {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly keys: readonly string[];
}

/** How the table chooses and describes its commands. */
export interface CommandsTableOptions {
  /** Only the commands of this category (`Cells`, `Commands`, …); every command when absent. */
  readonly category?: string;
  /** A finer choice than the category; applied after it. */
  readonly filter?: (command: RegisteredCommand) => boolean;
  /**
   * The keys a command answers to besides its Reactor `keybinding`: a host
   * with keys of its own (a grid's arrows, Enter, Delete) names them here.
   * Each in the Reactor keybinding format (`Mod+Alt+0`, `Shift+ArrowUp`).
   */
  readonly extraKeys?: (command: RegisteredCommand) => readonly string[];
  /** The table's title; *Commands* by default. */
  readonly title?: string;
  /** Under the title: what the table is for. */
  readonly subtitle?: string;
}

/** The rows a table shows for some commands: pure, so a test reads it without React. */
export function commandsTableRows(
  commands: readonly RegisteredCommand[],
  options: CommandsTableOptions = {},
): CommandsTableRow[] {
  return commands
    .filter((command) => options.category === undefined || command.category === options.category)
    .filter((command) => options.filter?.(command) ?? true)
    .map((command) => ({
      id: command.id,
      name: command.name,
      category: command.category ?? '',
      keys: [
        ...(command.keybinding !== undefined ? [command.keybinding] : []),
        ...(options.extraKeys?.(command) ?? []),
      ],
    }));
}

/** The commands, in a Primer table with their keys as keybinding hints. */
export function CommandsTable(options: CommandsTableOptions): React.JSX.Element {
  const commands = useCommands();
  const rows = useMemo(() => commandsTableRows(commands, options), [commands, options]);
  const title = options.title ?? 'Commands';
  const titleId = 'reactor-commands-table-title';
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
            header: 'Command',
            field: 'id',
            rowHeader: true,
            renderCell: (row) => <code data-command={row.id}>{row.id}</code>,
          },
          { header: 'Name', field: 'name' },
          ...(options.category === undefined
            ? [{ header: 'Category', field: 'category' as const }]
            : []),
          {
            header: 'Keys',
            id: 'keys',
            renderCell: (row) =>
              row.keys.length === 0 ? (
                <span aria-label="No keys">—</span>
              ) : (
                <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                  {row.keys.map((keys) => (
                    <KeybindingHint key={keys} keys={keys} size="small" />
                  ))}
                </span>
              ),
          },
        ]}
      />
    </Table.Container>
  );
}

/** The slot the table is contributed to by `commandsTablePlugin`. */
export const COMMANDS_TABLE_SLOT = 'commands-table';

/**
 * A plugin that contributes `CommandsTable`, configured, to a component slot:
 * the host draws it with `<ReactorSlot slot="commands-table" />`.
 */
export function commandsTablePlugin(
  options: CommandsTableOptions & { readonly slot?: string } = {},
) {
  const { slot = COMMANDS_TABLE_SLOT, ...table } = options;
  const Component = () => <CommandsTable {...table} />;
  return definePlugin({
    name: '@datalayer/reactor-commands-table',
    version: '1.0.0',
    displayName: 'Commands table',
    description: 'The registered commands in a table: their ids, names and keys.',
    octicon: 'table',
    build() {
      return { components: [{ slot, id: 'commands-table', Component }] };
    },
  });
}
