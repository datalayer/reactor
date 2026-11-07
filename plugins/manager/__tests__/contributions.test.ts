/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * BSD 3-Clause License
 */

import { describe, expect, it } from 'vitest';
import type { Contribution } from '@datalayer/reactor';
import {
  contributionsTablePlugin,
  contributionsTableRows,
  CONTRIBUTIONS_TABLE_SLOT,
} from '../src/contributions';

const c = (plugin: string, id: string): Contribution<unknown> => ({
  plugin,
  id,
  order: 0,
  value: null,
});

describe('the contributions table', () => {
  const described = [
    { point: 'app.function', contributions: [c('@acme/x', 'SHOUT'), c('@core/fns', 'SUM')] },
    { point: 'app.command', contributions: [c('@acme/x', 'acme.upper')] },
  ];

  it('shows every point holding something, with every plugin’s contributions', () => {
    expect(
      contributionsTableRows(described).map((r) => [r.id, r.contributions.map((e) => e.id)]),
    ).toEqual([
      ['app.function', ['SHOUT', 'SUM']],
      ['app.command', ['acme.upper']],
    ]);
  });

  it('keeps the points a host names, empty ones included, labelled, narrowed to one plugin', () => {
    const rows = contributionsTableRows(described, {
      points: ['app.command', { id: 'app.function' }, 'app.importer'],
      plugin: '@acme/x',
      labels: { 'app.function': 'functions' },
    });
    expect(rows).toEqual([
      { id: 'app.command', contributions: [{ id: 'acme.upper', plugin: '@acme/x' }] },
      {
        id: 'app.function',
        label: 'functions',
        contributions: [{ id: 'SHOUT', plugin: '@acme/x' }],
      },
      { id: 'app.importer', contributions: [] },
    ]);
  });

  it('is a plugin contributing the table to its slot', () => {
    const plugin = contributionsTablePlugin() as unknown as {
      name: string;
      build: () => { components: { slot: string; id: string }[] };
    };
    expect(plugin.name).toBe('@datalayer/reactor-contributions-table');
    expect(plugin.build().components.map((x) => [x.slot, x.id])).toEqual([
      [CONTRIBUTIONS_TABLE_SLOT, 'contributions-table'],
    ]);
  });
});
