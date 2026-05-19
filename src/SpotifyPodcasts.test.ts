import { http, HttpResponse } from 'msw';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  it('returns N episodes with pinned slots filled first', async () => {
    mockShowEpisodes('upfirst', [freshEpisode('upfirst')]);
    mockShowEpisodes('thedaily', [freshEpisode('thedaily')]);
    for (const id of OTHER_SHOW_IDS) {
      mockShowEpisodes(id, [freshEpisode(id)]);
    }

    const episodes = await fetchSpotifyPodcasts({ numberOfPodcasts: 8 });

    expect(episodes).toHaveLength(8);
    expect(episodes[0]?.id).toBe('upfirst_ep');
    expect(episodes[1]?.id).toBe('thedaily_ep');
  });

  it('falls through to the other pool when a pinned news show has no fresh episode', async () => {
    mockShowEpisodes('upfirst', [ep('upfirst', '2020-01-01')]);
    mockShowEpisodes('thedaily', [freshEpisode('thedaily')]);
    for (const id of OTHER_SHOW_IDS) {
      mockShowEpisodes(id, [freshEpisode(id)]);
    }

    const episodes = await fetchSpotifyPodcasts({ numberOfPodcasts: 8 });

    expect(episodes.map((e) => e.id)).not.toContain('upfirst_ep');
    expect(episodes[1]?.id).toBe('thedaily_ep');
  });

  it('skips fully_played episodes', async () => {
    mockShowEpisodes('upfirst', [
      ep('upfirst', '2026-05-18', true, '_newest'),
      ep('upfirst', '2026-05-17', false, '_older'),
    ]);
    mockShowEpisodes('thedaily', [freshEpisode('thedaily')]);
    for (const id of OTHER_SHOW_IDS) {
      mockShowEpisodes(id, [freshEpisode(id)]);
    }

    const episodes = await fetchSpotifyPodcasts({ numberOfPodcasts: 8 });

    const upFirstEp = episodes.find((e) => e.id.startsWith('upfirst_ep'));
    expect(upFirstEp?.id).toBe('upfirst_ep_older');
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
    expect(episodes.map((e) => e.id)).not.toContain('otherA_ep');
  });

  it('does not pick the same show twice across slots', async () => {
    mockShowEpisodes('upfirst', [freshEpisode('upfirst')]);
    mockShowEpisodes('thedaily', [freshEpisode('thedaily')]);
    for (const id of OTHER_SHOW_IDS) {
      mockShowEpisodes(id, [freshEpisode(id)]);
    }

    const episodes = await fetchSpotifyPodcasts({ numberOfPodcasts: 8 });

    const ids = episodes.map((e) => e.id);
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
    expect(new Set(episodes.map((e) => e.id)).size).toBe(6);
  });
});
