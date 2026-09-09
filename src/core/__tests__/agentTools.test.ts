/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/** A plugin declares what an agent may do with it; a host reads one place. */

import { describe, expect, it } from 'vitest';
import { buildReactorFromPlugins } from '../reactor';
import { contribution, definePlugin } from '../../index';
import { AgentTools, agentToolBundle, agentToolBundles, defineAgentTools } from '../agentTools';

const DECKS = defineAgentTools({
  id: 'decks',
  name: 'Decks',
  plugin: '@datalayer/decks',
  commands: [
    { name: 'decks_next_slide', command: 'decks.nextSlide', description: 'Next' },
    {
      name: 'decks_open',
      command: 'decks.open',
      description: 'Open',
      parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    },
  ],
});

describe('defineAgentTools', () => {
  it('fills the toolset from the commands and refuses bad names', () => {
    expect(DECKS.toolset).toEqual(['decks_next_slide', 'decks_open']);
    expect(() =>
      defineAgentTools({ id: 'x', name: 'x', commands: [{ name: 'has-dash', command: 'c', description: '' }] }),
    ).toThrow(/letters, digits and underscores/);
    expect(() =>
      defineAgentTools({
        id: 'x',
        name: 'x',
        commands: [
          { name: 'twice', command: 'a', description: '' },
          { name: 'twice', command: 'b', description: '' },
        ],
      }),
    ).toThrow(/declared twice/);
  });
});

describe('AgentTools', () => {
  it('is read from the platform like any contribution point', async () => {
    const decks = definePlugin({
      name: '@datalayer/decks',
      contributes: [contribution(AgentTools, DECKS, { id: 'decks' })],
    });
    const reactor = buildReactorFromPlugins([decks]);
    reactor.start();
    await reactor.whenReady();
    expect(agentToolBundles(reactor)).toEqual([DECKS]);
    expect(agentToolBundle(reactor, 'decks')?.commands.map((c) => c.command)).toEqual([
      'decks.nextSlide',
      'decks.open',
    ]);
    expect(agentToolBundle(reactor, 'nobody')).toBeUndefined();
  });
});
