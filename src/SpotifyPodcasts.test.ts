import { describe, expect, it } from 'vitest';
import { mockShowEpisodes, mockShowEpisodesEmpty } from './__tests__/mswServer.js';
import type { PodcastConfig } from './PodcastConfig.js';
import { selectPodcastSlots } from './SpotifyPodcasts.js';

const NOW = new Date('2026-05-18T12:00:00Z');

const upFirst = { name: 'Up First from NPR', spotify_show_id: 'upfirst', category: 'news', pin_slot: 1 };
const theDaily = { name: 'The Daily', spotify_show_id: 'thedaily', category: 'news', pin_slot: 2 };
const nprNewsNow = { name: 'NPR News Now', spotify_show_id: 'nprnewsnow', category: 'news' };
const todayExplained = { name: 'Today Explained', spotify_show_id: 'todayexplained', category: 'news' };
const otherA = { name: 'Other A', spotify_show_id: 'otherA', category: 'other' };
const otherB = { name: 'Other B', spotify_show_id: 'otherB', category: 'other' };
const otherC = { name: 'Other C', spotify_show_id: 'otherC', category: 'other' };
const otherD = { name: 'Other D', spotify_show_id: 'otherD', category: 'other' };
const otherE = { name: 'Other E', spotify_show_id: 'otherE', category: 'other' };
const otherF = { name: 'Other F', spotify_show_id: 'otherF', category: 'other' };

const baseConfig: PodcastConfig = {
  shows: [upFirst, theDaily, nprNewsNow, todayExplained, otherA, otherB, otherC, otherD, otherE, otherF],
};

function ep(showId: string, releaseDate: string, fullyPlayed = false, suffix = '') {
  return {
    id: `${showId}_ep${suffix}`,
    name: `${showId} episode${suffix}`,
    release_date: releaseDate,
    fully_played: fullyPlayed,
  };
}

describe('selectPodcastSlots', () => {
  it('picks Up First for slot 1 and The Daily for slot 2 when both fresh + unplayed', async () => {
    mockShowEpisodes('upfirst', [ep('upfirst', '2026-05-18')]);
    mockShowEpisodes('thedaily', [ep('thedaily', '2026-05-18')]);
    mockShowEpisodes('otherA', [ep('otherA', '2026-05-10')]);
    mockShowEpisodes('otherB', [ep('otherB', '2026-05-11')]);
    mockShowEpisodes('otherC', [ep('otherC', '2026-05-12')]);
    mockShowEpisodes('otherD', [ep('otherD', '2026-05-13')]);
    mockShowEpisodes('otherE', [ep('otherE', '2026-05-14')]);
    mockShowEpisodes('otherF', [ep('otherF', '2026-05-15')]);

    const { episodes, skipped } = await selectPodcastSlots(baseConfig, {
      numberOfPodcasts: 8,
      now: NOW,
      shuffle: (items) => [...items],
    });

    expect(episodes).toHaveLength(8);
    expect(episodes[0]?.show_id).toBe('upfirst');
    expect(episodes[1]?.show_id).toBe('thedaily');
    expect(episodes.slice(2).map((e) => e.show_id)).toEqual([
      'otherA',
      'otherB',
      'otherC',
      'otherD',
      'otherE',
      'otherF',
    ]);
    expect(skipped).toEqual([]);
  });

  it('falls through to the other pool when the pinned news show has no fresh episode', async () => {
    mockShowEpisodes('upfirst', [ep('upfirst', '2026-04-01')]);
    mockShowEpisodes('thedaily', [ep('thedaily', '2026-05-18')]);
    mockShowEpisodes('otherA', [ep('otherA', '2026-05-15')]);
    mockShowEpisodes('otherB', [ep('otherB', '2026-05-15')]);
    mockShowEpisodes('otherC', [ep('otherC', '2026-05-15')]);
    mockShowEpisodes('otherD', [ep('otherD', '2026-05-15')]);
    mockShowEpisodes('otherE', [ep('otherE', '2026-05-15')]);
    mockShowEpisodes('otherF', [ep('otherF', '2026-05-15')]);

    const { episodes } = await selectPodcastSlots(baseConfig, {
      numberOfPodcasts: 8,
      now: NOW,
      shuffle: (items) => [...items],
    });

    expect(episodes[0]?.show_id).toBe('otherA');
    expect(episodes[1]?.show_id).toBe('thedaily');
  });

  it('substitutes the next sampled "other" show when one has no fresh-unplayed episode', async () => {
    mockShowEpisodes('upfirst', [ep('upfirst', '2026-05-18')]);
    mockShowEpisodes('thedaily', [ep('thedaily', '2026-05-18')]);
    mockShowEpisodes('otherA', [ep('otherA', '2025-01-01')]);
    mockShowEpisodes('otherB', [ep('otherB', '2026-05-15')]);
    mockShowEpisodes('otherC', [ep('otherC', '2026-05-15')]);
    mockShowEpisodes('otherD', [ep('otherD', '2026-05-15')]);
    mockShowEpisodes('otherE', [ep('otherE', '2026-05-15')]);
    mockShowEpisodes('otherF', [ep('otherF', '2026-05-15')]);

    const { episodes, skipped } = await selectPodcastSlots(baseConfig, {
      numberOfPodcasts: 7,
      now: NOW,
      shuffle: (items) => [...items],
    });

    expect(episodes).toHaveLength(7);
    expect(episodes.map((e) => e.show_id)).not.toContain('otherA');
    expect(skipped).toContainEqual({
      show_name: 'Other A',
      reason: 'no_fresh_unplayed_episode',
    });
  });

  it('skips fully_played episodes and picks the next-latest', async () => {
    mockShowEpisodes('upfirst', [
      ep('upfirst', '2026-05-18', true, '_newest'),
      ep('upfirst', '2026-05-17', false, '_older'),
    ]);
    mockShowEpisodes('thedaily', [ep('thedaily', '2026-05-18')]);
    mockShowEpisodes('otherA', [ep('otherA', '2026-05-15')]);
    mockShowEpisodes('otherB', [ep('otherB', '2026-05-15')]);
    mockShowEpisodes('otherC', [ep('otherC', '2026-05-15')]);
    mockShowEpisodes('otherD', [ep('otherD', '2026-05-15')]);
    mockShowEpisodes('otherE', [ep('otherE', '2026-05-15')]);
    mockShowEpisodes('otherF', [ep('otherF', '2026-05-15')]);

    const { episodes } = await selectPodcastSlots(baseConfig, {
      numberOfPodcasts: 8,
      now: NOW,
      shuffle: (items) => [...items],
    });

    expect(episodes[0]?.show_id).toBe('upfirst');
    expect(episodes[0]?.spotify_episode_id).toBe('upfirst_ep_older');
  });

  it('fills all slots from the other pool when both pinned news shows are dry', async () => {
    mockShowEpisodesEmpty('upfirst');
    mockShowEpisodesEmpty('thedaily');
    mockShowEpisodes('otherA', [ep('otherA', '2026-05-15')]);
    mockShowEpisodes('otherB', [ep('otherB', '2026-05-15')]);
    mockShowEpisodes('otherC', [ep('otherC', '2026-05-15')]);
    mockShowEpisodes('otherD', [ep('otherD', '2026-05-15')]);
    mockShowEpisodes('otherE', [ep('otherE', '2026-05-15')]);
    mockShowEpisodes('otherF', [ep('otherF', '2026-05-15')]);
    mockShowEpisodes('otherG', [ep('otherG', '2026-05-15')]);
    mockShowEpisodes('otherH', [ep('otherH', '2026-05-15')]);

    const fullConfig: PodcastConfig = {
      shows: [
        ...baseConfig.shows,
        { name: 'Other G', spotify_show_id: 'otherG', category: 'other' },
        { name: 'Other H', spotify_show_id: 'otherH', category: 'other' },
      ],
    };

    const { episodes } = await selectPodcastSlots(fullConfig, {
      numberOfPodcasts: 8,
      now: NOW,
      shuffle: (items) => [...items],
    });

    expect(episodes).toHaveLength(8);
    expect(new Set(episodes.map((e) => e.show_id)).size).toBe(8);
  });
});
