import type { SimplifiedEpisode, Track } from '@spotify/web-api-ts-sdk';
import { http, HttpResponse } from 'msw';
import { describe, expect, it } from 'vitest';
import { mswServer } from './__tests__/mswServer.js';
import { assemblePlan } from './DailyDrivePlan.js';
import { planDescription, planToUris, replacePlaylist } from './SpotifyPlaylist.js';

function ep(id: string, name: string): SimplifiedEpisode {
  return {
    id,
    name,
    release_date: '2026-05-18',
    duration_ms: 30 * 60 * 1000,
    is_playable: true,
    uri: `spotify:episode:${id}`,
  } as unknown as SimplifiedEpisode;
}

function tr(id: string): Track {
  return { id, name: `Track ${id}`, uri: `spotify:track:${id}` } as unknown as Track;
}

function makePlan() {
  const episodes = [ep('e1', 'Up First May 18'), ep('e2', 'The Daily May 18')];
  const tracks = Array.from({ length: 5 }, (_, i) => tr(`t${i + 1}`));
  return assemblePlan(episodes, tracks, {
    numberOfPodcasts: 2,
    dryRun: false,
    now: new Date('2026-05-18T10:00:00Z'),
  });
}

describe('planToUris', () => {
  it('emits spotify:episode and spotify:track uris in plan order', () => {
    const plan = makePlan();
    const uris = planToUris(plan);
    expect(uris[0]).toBe('spotify:episode:e1');
    expect(uris[1]).toBe('spotify:track:t1');
    expect(uris[2]).toBe('spotify:track:t2');
    expect(uris[3]).toBe('spotify:episode:e2');
    expect(uris.at(-1)).toBe('spotify:track:t5');
    expect(uris).toHaveLength(plan.items.length);
  });
});

describe('planDescription', () => {
  it('includes the run date and episode names in order', () => {
    const plan = makePlan();
    expect(planDescription(plan)).toBe('Daily Drive · 2026-05-18 · Up First May 18, The Daily May 18');
  });
});

describe('replacePlaylist', () => {
  it('PUTs uris and PUTs details against the Spotify API', async () => {
    const plan = makePlan();
    const observed: { uris?: string[]; details?: Record<string, unknown> } = {};

    mswServer.use(
      http.put(
        'https://api.spotify.com/v1/playlists/playlist123/tracks',
        async ({ request }) => {
          const body = (await request.json()) as { uris: string[] };
          observed.uris = body.uris;
          return HttpResponse.json({ snapshot_id: 'snap_after_replace' });
        },
      ),
      http.put('https://api.spotify.com/v1/playlists/playlist123', async ({ request }) => {
        observed.details = (await request.json()) as Record<string, unknown>;
        return new HttpResponse(null, { status: 200 });
      }),
    );

    await replacePlaylist('playlist123', plan);

    expect(observed.uris).toEqual(planToUris(plan));
    expect(observed.details).toEqual({
      name: 'Daily Drive',
      description: 'Daily Drive · 2026-05-18 · Up First May 18, The Daily May 18',
    });
  });
});
