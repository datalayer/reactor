/*
 * Copyright (c) 2026-Present Datalayer, Inc.
 *
 * Datalayer License
 */

/**
 * Playlist plugin — the plugin that *offers an extension point*.
 *
 * A slot answers "render everything plugins put here". This plugin needs the
 * other kind of answer: it owns a playlist view and asks other plugins "what
 * ways of choosing songs do you know?", then puts one of them on screen at a
 * time. That question is an extension point.
 *
 * The plugin holds no rules of its own on purpose. On its own it renders an
 * empty playlist that says so — which is exactly what you see when the mood
 * plugin is switched off in the Plugins panel.
 *
 * @module playlist-plugin
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Button, Text } from '@primer/react';
import { Box, Card } from '@datalayer/primer-addons';
import { defineExtension, defineExtensionPoint } from '@datalayer/reactor';
import { useBackendPlugin, useContributions } from '@datalayer/reactor/react';
import {
  CatalogExtension,
  useCatalogSongs,
  type Song,
} from '@datalayer-examples/reactor-music-catalog-plugin';

/**
 * What a plugin offers when it extends the playlist.
 *
 * `select` is the whole contract: given the catalog, return the songs this
 * rule wants and the order it wants them in. Returning a subset is how a rule
 * filters; returning them reordered is how it ranks.
 */
export type PlaylistRule = {
  /** Named on the chooser. */
  title: string;
  /** One line, under the chooser, saying what this rule did. */
  description: string;
  /** Pick and order the songs. Never mutates the array it is given. */
  select: (songs: Song[]) => Song[];
};

/**
 * The extension point.
 *
 * The id is the contract between plugins; the type parameter is what makes
 * contributing to it type-safe. `music.playlistRule` is what the mood plugin
 * contributes to.
 */
export const PlaylistRuleExtension = defineExtensionPoint<PlaylistRule>(
  'music.playlistRule',
);

function EmptyPlaylist() {
  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Text sx={{ color: 'fg.muted' }}>
        No playlist rules are installed. This plugin owns the playlist, not the
        ways of filling it — those come from other plugins.
      </Text>
      <Text sx={{ color: 'fg.muted', fontSize: 1 }}>
        Switch <strong>@music/mood</strong> back on in the Plugins panel and its
        rules appear here immediately.
      </Text>
    </Box>
  );
}

function Playlist() {
  const { songs, loading, error } = useCatalogSongs();

  // An optional backend plugin is the extension's own business: nothing gates
  // this component on it, so it asks and adapts.
  const hasServerRules = useBackendPlugin('playlist');

  // Everything plugins have offered at the point. This re-renders on its own
  // when a contributing plugin is enabled or disabled, so the chooser is never
  // stale: withdrawing a contribution is part of disabling an extension.
  const rules = useContributions(PlaylistRuleExtension);

  const [activeId, setActiveId] = useState<string | undefined>(undefined);

  // Keep a valid rule selected: the active one disappears when its plugin is
  // switched off, and there is nothing to select before the first arrives.
  const active = useMemo(
    () => rules.find((entry) => entry.id === activeId) ?? rules[0],
    [rules, activeId],
  );
  useEffect(() => {
    if (active && active.id !== activeId) {
      setActiveId(active.id);
    }
  }, [active, activeId]);

  const selection = useMemo(
    () => (active ? active.value.select(songs) : []),
    [active, songs],
  );

  return (
    <Card border rounded="medium" shadow="small">
      <Card.Header
        title="Playlist"
        description="Owned by the playlist plugin. Filled by whatever contributes to its `music.playlistRule` extension point."
      />
      <Card.Content>
        {loading && <Text sx={{ color: 'fg.muted' }}>Loading catalog…</Text>}
        {error && (
          <Text sx={{ color: 'danger.fg' }}>Failed to load catalog: {error}</Text>
        )}
        {!loading && !error && rules.length === 0 && <EmptyPlaylist />}
        {!loading && !error && rules.length > 0 && (
          <Box sx={{ display: 'grid', gap: 3 }}>
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              {rules.map((entry) => (
                <Button
                  key={entry.id}
                  variant={entry.id === active?.id ? 'primary' : 'default'}
                  onClick={() => setActiveId(entry.id)}
                >
                  {entry.value.title}
                </Button>
              ))}
            </Box>

            {active && (
              <Text sx={{ color: 'fg.muted', fontSize: 1 }}>
                {active.value.description} — contributed by{' '}
                <strong>{active.extension}</strong>.
              </Text>
            )}

            <Text sx={{ color: 'fg.muted', fontSize: 0 }}>
              {hasServerRules
                ? 'The Python playlist plugin is running too: the same rules are served at /api/playlist.'
                : 'The Python playlist plugin is switched off — an optional backend, so this card is unaffected.'}
            </Text>

            <Box sx={{ display: 'grid', gap: 2 }}>
              {selection.map((song, index) => (
                <Box
                  key={song.id}
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 3,
                    py: 1,
                    borderBottom: '1px solid',
                    borderColor: 'border.muted',
                  }}
                >
                  <Text>
                    <Text sx={{ color: 'fg.muted' }}>{index + 1}.</Text>{' '}
                    <strong>{song.title}</strong> — {song.artist}
                  </Text>
                  <Text sx={{ color: 'fg.muted' }}>${song.price.toFixed(2)}</Text>
                </Box>
              ))}
            </Box>
          </Box>
        )}
      </Card.Content>
    </Card>
  );
}

/**
 * Playlist extension: depends on the catalog for songs, and opens the
 * `music.playlistRule` extension point for other plugins to fill.
 */
export const PlaylistExtension = defineExtension({
  name: '@music/playlist',
  version: '1.0.0',
  displayName: 'Playlist',
  description:
    'Owns the playlist and opens the music.playlistRule extension point. Ships no rules of its own.',
  octicon: 'list-unordered',
  emoji: '🎧',
  dependencies: [CatalogExtension],
  requiredBackendPlugins: ['catalog'],
  // Declared so a host can draw the point, and show it even when nothing has
  // been contributed to it yet — the registry only ever knows contributors.
  extensionPoints: [PlaylistRuleExtension],
  // The Python `playlist` plugin serves the same rules over HTTP. This view
  // does not need it — its rules come from the extension point in the browser
  // — so it is declared optional: when the backend is there the card says so,
  // and when it is not the card is exactly as useful.
  optionalBackendPlugins: ['playlist'],
  build() {
    return {
      components: [
        {
          slot: 'playlist',
          id: 'playlist',
          Component: Playlist,
          requiredBackendPlugins: ['catalog'],
        },
      ],
    };
  },
});
