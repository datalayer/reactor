/*
 * Copyright (c) 2025-2026 Datalayer, Inc.
 * Distributed under the terms of the Modified BSD License.
 */

import { describe, expect, it } from 'vitest';
import type { RegisteredCommand } from '@datalayer/reactor';
import { commandsTableRows, commandsTablePlugin, COMMANDS_TABLE_SLOT } from '../src/table';

const command = (id: string, category: string, keybinding?: string): RegisteredCommand =>
  ({
    id,
    name: id.toUpperCase(),
    category,
    keybinding,
    execute: () => undefined,
  }) as unknown as RegisteredCommand;

describe('the commands table', () => {
  const commands = [
    command('cells.bold', 'Cells', 'Mod+B'),
    command('cells.hideColumns', 'Cells', 'Mod+Alt+0'),
    command('commands.showPalette', 'Commands', 'Mod+K'),
    command('cells.goTo', 'Cells'),
  ];

  it('lists every command, or one category, with its keys', () => {
    expect(commandsTableRows(commands).map((row) => row.id)).toEqual([
      'cells.bold',
      'cells.hideColumns',
      'commands.showPalette',
      'cells.goTo',
    ]);
    const cells = commandsTableRows(commands, { category: 'Cells' });
    expect(cells.map((row) => [row.id, row.keys])).toEqual([
      ['cells.bold', ['Mod+B']],
      ['cells.hideColumns', ['Mod+Alt+0']],
      ['cells.goTo', []],
    ]);
  });

  it('adds the keys a host names besides the keybinding, after it', () => {
    const rows = commandsTableRows(commands, {
      category: 'Cells',
      extraKeys: (c) => (c.id === 'cells.goTo' ? ['Mod+G', 'F5'] : []),
    });
    expect(rows.find((row) => row.id === 'cells.goTo')?.keys).toEqual(['Mod+G', 'F5']);
  });

  it('is a plugin contributing the table to its slot', () => {
    const plugin = commandsTablePlugin({ category: 'Cells' }) as unknown as {
      name: string;
      build: () => { components: { slot: string; id: string }[] };
    };
    expect(plugin.name).toBe('@datalayer/reactor-commands-table');
    expect(plugin.build().components.map((c) => [c.slot, c.id])).toEqual([
      [COMMANDS_TABLE_SLOT, 'commands-table'],
    ]);
    const elsewhere = commandsTablePlugin({ slot: 'side' }) as unknown as {
      build: () => { components: { slot: string }[] };
    };
    expect(elsewhere.build().components[0].slot).toBe('side');
  });
});
