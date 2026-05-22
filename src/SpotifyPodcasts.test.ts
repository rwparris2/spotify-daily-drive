import _ from 'lodash';
import { http, HttpResponse } from 'msw';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  mockShowEpisodes,
  mockShowEpisodesEmpty,
  mockShowEpisodesError,
  mswServer,
} from './__tests__/mswServer.js';
import { fetchSpotifyPodcasts } from './SpotifyPodcasts.js';

const OTHER_SHOW_IDS = ['otherA', 'otherB', 'otherC', 'otherD', 'otherE', 'otherF'];

function ep(showId: string, releaseDate: string, fullyPlayed = false, suffix = '') {
  return {
    id: `${showId}_ep${suffix}`,
    name: `${showId} episode${suffix}`,
    release_date: releaseDate,
    fully_played: fullyPlayed,
  };
}

function freshEpisode(showId: string) {
  return ep(showId, new Date().toISOString().slice(0, 10));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchSpotifyPodcasts', () => {
  beforeEach(() => {
    // Deterministically pick the first entry of any random pool — keeps
    // every pre-existing assertion stable now that slot 2 has a tied entry.
    // We spy on _.random directly because lodash captures Math.random at
    // module load time and vi.spyOn(Math, 'random') would not intercept it.
    vi.spyOn(_, 'random').mockReturnValue(0);
    // The catch-and-fall-through in pickLatestEligibleEpisode logs to
    // console.error whenever a fixture show isn't mocked. Tests that need
    // to verify error logging do their own local spy below.
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('returns N episodes with pinned slots filled first', async () => {
    mockShowEpisodes('upfirst', [freshEpisode('upfirst')]);
    mockShowEpisodes('thedaily', [freshEpisode('thedaily')]);
    for (const id of OTHER_SHOW_IDS) {
      mockShowEpisodes(id, [freshEpisode(id)]);
    }

    const episodes = await fetchSpotifyPodcasts({ numberOfPodcasts: 8 });

    expect(episodes).toHaveLength(8);
    expect(episodes[0]?.episode.id).toBe('upfirst_ep');
    expect(episodes[1]?.episode.id).toBe('thedaily_ep');
  });

  it('falls through to the other pool when a pinned latest_only show has its newest already played', async () => {
    mockShowEpisodes('upfirst', [ep('upfirst', '2026-05-18', true)]);
    mockShowEpisodes('thedaily', [freshEpisode('thedaily')]);
    for (const id of OTHER_SHOW_IDS) {
      mockShowEpisodes(id, [freshEpisode(id)]);
    }

    const episodes = await fetchSpotifyPodcasts({ numberOfPodcasts: 8 });

    expect(episodes.map((e) => e.episode.id)).not.toContain('upfirst_ep');
    expect(episodes[1]?.episode.id).toBe('thedaily_ep');
  });

  it('falls back to next-newest non-fully-played episode for non-latest_only shows', async () => {
    mockShowEpisodes('upfirst', [freshEpisode('upfirst')]);
    mockShowEpisodes('thedaily', [freshEpisode('thedaily')]);
    mockShowEpisodes('otherA', [
      ep('otherA', '2026-05-18', true, '_newest'),
      ep('otherA', '2026-05-17', false, '_older'),
    ]);
    for (const id of OTHER_SHOW_IDS.slice(1)) {
      mockShowEpisodes(id, [freshEpisode(id)]);
    }

    const episodes = await fetchSpotifyPodcasts({ numberOfPodcasts: 8 });

    const otherAEp = episodes.find((e) => e.episode.id.startsWith('otherA_ep'));
    expect(otherAEp?.episode.id).toBe('otherA_ep_older');
  });

  it('continues past a show whose episode fetch errors out', async () => {
    mockShowEpisodes('upfirst', [freshEpisode('upfirst')]);
    mockShowEpisodes('thedaily', [freshEpisode('thedaily')]);
    mockShowEpisodesError('otherA');
    for (const id of OTHER_SHOW_IDS.slice(1)) {
      mockShowEpisodes(id, [freshEpisode(id)]);
    }
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const episodes = await fetchSpotifyPodcasts({ numberOfPodcasts: 7 });

    expect(episodes).toHaveLength(7);
    expect(episodes.map((e) => e.episode.id)).not.toContain('otherA_ep');
  });

  it('does not pick the same show twice across slots', async () => {
    mockShowEpisodes('upfirst', [freshEpisode('upfirst')]);
    mockShowEpisodes('thedaily', [freshEpisode('thedaily')]);
    for (const id of OTHER_SHOW_IDS) {
      mockShowEpisodes(id, [freshEpisode(id)]);
    }

    const episodes = await fetchSpotifyPodcasts({ numberOfPodcasts: 8 });

    const ids = episodes.map((e) => e.episode.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('does not re-fetch a show whose first lookup returned nothing eligible', async () => {
    mockShowEpisodes('upfirst', [freshEpisode('upfirst')]);
    mockShowEpisodes('thedaily', [freshEpisode('thedaily')]);
    for (const id of OTHER_SHOW_IDS.slice(1)) {
      mockShowEpisodes(id, [freshEpisode(id)]);
    }

    let otherACallCount = 0;
    mswServer.use(
      http.get('https://api.spotify.com/v1/shows/otherA/episodes', () => {
        otherACallCount++;
        return HttpResponse.json({
          items: [],
          total: 0,
          limit: 50,
          offset: 0,
          next: null,
          previous: null,
          href: '',
        });
      }),
    );

    await fetchSpotifyPodcasts({ numberOfPodcasts: 8 });

    expect(otherACallCount).toBeLessThanOrEqual(1);
  });

  it('fills all slots from the other pool when both pinned news shows are dry', async () => {
    mockShowEpisodesEmpty('upfirst');
    mockShowEpisodesEmpty('thedaily');
    for (const id of OTHER_SHOW_IDS) {
      mockShowEpisodes(id, [freshEpisode(id)]);
    }

    const episodes = await fetchSpotifyPodcasts({ numberOfPodcasts: 6 });

    expect(episodes).toHaveLength(6);
    expect(new Set(episodes.map((e) => e.episode.id)).size).toBe(6);
  });

  it('latest_only: picks the single newest episode even when older than 6 months', async () => {
    mockShowEpisodes('upfirst', [
      ep('upfirst', '2020-01-01', false, '_newest'),
      ep('upfirst', '2019-12-31', false, '_older'),
    ]);
    mockShowEpisodes('thedaily', [freshEpisode('thedaily')]);
    for (const id of OTHER_SHOW_IDS) {
      mockShowEpisodes(id, [freshEpisode(id)]);
    }

    const episodes = await fetchSpotifyPodcasts({ numberOfPodcasts: 8 });

    expect(episodes[0]?.episode.id).toBe('upfirst_ep_newest');
  });

  it('latest_only: skips the show entirely when the newest episode is fully_played', async () => {
    mockShowEpisodes('upfirst', [
      ep('upfirst', '2026-05-18', true, '_newest'),
      ep('upfirst', '2026-05-17', false, '_older'),
    ]);
    mockShowEpisodes('thedaily', [freshEpisode('thedaily')]);
    for (const id of OTHER_SHOW_IDS) {
      mockShowEpisodes(id, [freshEpisode(id)]);
    }

    const episodes = await fetchSpotifyPodcasts({ numberOfPodcasts: 8 });

    expect(episodes.map((e) => e.episode.id)).not.toContain('upfirst_ep_newest');
    expect(episodes.map((e) => e.episode.id)).not.toContain('upfirst_ep_older');
  });

  it('tied pin_slot: both shows are reachable depending on the random roll', async () => {
    mockShowEpisodes('upfirst', [freshEpisode('upfirst')]);
    mockShowEpisodes('thedaily', [freshEpisode('thedaily')]);
    mockShowEpisodes('flightpod', [freshEpisode('flightpod')]);
    for (const id of OTHER_SHOW_IDS) {
      mockShowEpisodes(id, [freshEpisode(id)]);
    }

    // beforeEach already pinned _.random = () => 0 — picks the first entry
    // in any tied pool, so slot 2 resolves to thedaily.
    const first = await fetchSpotifyPodcasts({ numberOfPodcasts: 8 });

    // Re-pin _.random to always return the last index of any pool — picks
    // flightpod (index 1) for the 2-element slot-2 pool, and still works
    // for single-element pools (index 0) because _.random(0) → 0.
    vi.restoreAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(_, 'random').mockImplementation((n: number) => n);
    const second = await fetchSpotifyPodcasts({ numberOfPodcasts: 8 });

    expect(first[1]?.episode.id).toBe('thedaily_ep');
    expect(second[1]?.episode.id).toBe('flightpod_ep');
  });
});
