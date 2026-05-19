import type { SimplifiedEpisode, Track } from '@spotify/web-api-ts-sdk';
import { describe, expect, it } from 'vitest';
import {
  assemblePlan,
  InsufficientCandidatesError,
  largestViableN,
  songsNeeded,
} from './DailyDrivePlan.js';

function ep(id: string): SimplifiedEpisode {
  return {
    id,
    name: `Episode ${id}`,
    release_date: '2026-05-18',
    duration_ms: 30 * 60 * 1000,
    is_playable: true,
    uri: `spotify:episode:${id}`,
  } as unknown as SimplifiedEpisode;
}

function tr(id: string): Track {
  return { id, name: `Track ${id}`, uri: `spotify:track:${id}` } as unknown as Track;
}

describe('songsNeeded', () => {
  it('matches the closed-form sum 2..N+1', () => {
    expect(songsNeeded(5)).toBe(20);
    expect(songsNeeded(8)).toBe(44);
    expect(songsNeeded(1)).toBe(2);
  });
});

describe('largestViableN', () => {
  it('returns the cap when both inputs are sufficient', () => {
    expect(largestViableN(8, 44, 8)).toBe(8);
    expect(largestViableN(20, 200, 8)).toBe(8);
  });

  it('scales down when episodes are short', () => {
    expect(largestViableN(5, 200, 8)).toBe(5);
  });

  it('scales down when tracks are short', () => {
    expect(largestViableN(8, 20, 8)).toBe(5);
    expect(largestViableN(8, 19, 8)).toBe(4);
  });

  it('returns 0 when nothing is viable', () => {
    expect(largestViableN(0, 100, 8)).toBe(0);
    expect(largestViableN(8, 1, 8)).toBe(0);
  });
});

describe('assemblePlan', () => {
  it('produces N podcasts + sum(2..N+1) songs in n+1 interleave order, ending on songs (N=8)', () => {
    const episodes = Array.from({ length: 8 }, (_, i) => ep(`e${i + 1}`));
    const tracks = Array.from({ length: 44 }, (_, i) => tr(`t${i + 1}`));

    const plan = assemblePlan(episodes, tracks, {
      numberOfPodcasts: 8,
      dryRun: false,
      now: new Date('2026-05-18T10:00:00Z'),
    });

    expect(plan.items).toHaveLength(52);
    expect(plan.items[0]).toMatchObject({ kind: 'podcast', slot: 1 });
    expect(plan.items[1]?.kind).toBe('song');
    expect(plan.items[2]?.kind).toBe('song');
    expect(plan.items[3]).toMatchObject({ kind: 'podcast', slot: 2 });
    expect(plan.items.at(-1)?.kind).toBe('song');

    const podcastIndices = plan.items
      .map((it, i) => (it.kind === 'podcast' ? i : -1))
      .filter((i) => i >= 0);
    const songRunLengths = podcastIndices.map((pi, idx) => {
      const next = podcastIndices[idx + 1] ?? plan.items.length;
      return next - pi - 1;
    });
    expect(songRunLengths).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('emits unique track ids across the plan', () => {
    const episodes = Array.from({ length: 8 }, (_, i) => ep(`e${i + 1}`));
    const tracks = Array.from({ length: 44 }, (_, i) => tr(`t${i + 1}`));
    const plan = assemblePlan(episodes, tracks, { numberOfPodcasts: 8, dryRun: false });
    const songIds = plan.items.flatMap((it) => (it.kind === 'song' ? [it.track.id] : []));
    expect(new Set(songIds).size).toBe(songIds.length);
  });

  it('carries dry_run through', () => {
    const episodes = Array.from({ length: 2 }, (_, i) => ep(`e${i + 1}`));
    const tracks = Array.from({ length: 5 }, (_, i) => tr(`t${i + 1}`));
    const plan = assemblePlan(episodes, tracks, { numberOfPodcasts: 2, dryRun: true });
    expect(plan.dry_run).toBe(true);
  });

  it('throws InsufficientCandidatesError on too few podcasts', () => {
    const episodes = Array.from({ length: 7 }, (_, i) => ep(`e${i + 1}`));
    const tracks = Array.from({ length: 44 }, (_, i) => tr(`t${i + 1}`));
    expect(() => assemblePlan(episodes, tracks, { numberOfPodcasts: 8, dryRun: false })).toThrow(
      InsufficientCandidatesError,
    );
  });

  it('throws InsufficientCandidatesError on too few songs', () => {
    const episodes = Array.from({ length: 8 }, (_, i) => ep(`e${i + 1}`));
    const tracks = Array.from({ length: 43 }, (_, i) => tr(`t${i + 1}`));
    expect(() => assemblePlan(episodes, tracks, { numberOfPodcasts: 8, dryRun: false })).toThrow(
      InsufficientCandidatesError,
    );
  });
});
