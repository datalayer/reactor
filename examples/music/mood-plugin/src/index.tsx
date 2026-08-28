/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Mood plugin — the plugin that *uses* another plugin's extension point.
 *
 * It contributes nothing to a slot and renders nothing of its own. Everything
 * it offers reaches the screen through the playlist plugin, which owns the
 * `music.playlistRule` point and decides which rule is showing.
 *
 * That is the whole shape worth learning from this pair: the playlist plugin
 * does not import this one, does not know it exists, and works without it. The
 * dependency runs the other way — this plugin depends on the playlist plugin,
 * because a contribution is worthless without the point it is made to.
 *
 * @module mood-plugin
 */

import { contribution, defineExtension } from '@datalayer/reactor';
import type { Song } from '@datalayer-examples/reactor-music-catalog-plugin';
import {
  PlaylistExtension,
  PlaylistRuleExtension,
  type PlaylistRule,
} from '@datalayer-examples/reactor-music-playlist-plugin';

/** Sort a copy: a rule is handed the catalog, it does not own it. */
const sortedBy = (songs: Song[], compare: (a: Song, b: Song) => number): Song[] =>
  [...songs].sort(compare);

/**
 * An unhurried listen: the cheapest songs, which in this invented catalog are
 * the quiet ones. Any rule may return a subset — this one keeps four.
 */
const CHILL: PlaylistRule = {
  title: 'Chill',
  description: 'Four gentle tracks, cheapest first',
  select: (songs) => sortedBy(songs, (a, b) => a.price - b.price).slice(0, 4),
};

/** The opposite end, and the whole catalog rather than a slice. */
const ENERGETIC: PlaylistRule = {
  title: 'Energetic',
  description: 'Everything, loudest bill first',
  select: (songs) => sortedBy(songs, (a, b) => b.price - a.price),
};

/** A rule needs no ranking at all — alphabetical is a mood too. */
const ALPHABETICAL: PlaylistRule = {
  title: 'A to Z',
  description: 'Every track, by title',
  select: (songs) => sortedBy(songs, (a, b) => a.title.localeCompare(b.title)),
};

/**
 * Mood extension: three rules for the playlist plugin's extension point.
 *
 * They are declared with `contributes` rather than contributed imperatively in
 * `register`, because none of them depends on this plugin's build output. The
 * reactor applies them in the register phase and — this is the part the Plugins
 * panel demonstrates — withdraws all three the moment this extension is
 * disabled.
 */
export const MoodExtension = defineExtension({
  name: '@music/mood',
  version: '1.0.0',
  displayName: 'Moods',
  description:
    'Three ways to fill a playlist, contributed to the playlist plugin. Renders nothing itself.',
  octicon: 'sun',
  emoji: '🌤️',
  dependencies: [PlaylistExtension],
  contributes: [
    contribution(PlaylistRuleExtension, CHILL, { id: 'chill', order: 0 }),
    contribution(PlaylistRuleExtension, ENERGETIC, { id: 'energetic', order: 1 }),
    contribution(PlaylistRuleExtension, ALPHABETICAL, { id: 'a-to-z', order: 2 }),
  ],
});
