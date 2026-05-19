import type { Track } from '@spotify/web-api-ts-sdk';
import type { EpisodeCandidate } from './SpotifyPodcasts.js';

export type PlanItem =
  | { kind: 'podcast'; episode: EpisodeCandidate; slot: number }
  | { kind: 'song'; track: Track };

export type DailyDrivePlan = {
  items: PlanItem[];
  generated_at: string;
  dry_run: boolean;
};

export class InsufficientCandidatesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientCandidatesError';
  }
}

export function songsNeeded(numberOfPodcasts: number): number {
  return ((numberOfPodcasts + 1) * (numberOfPodcasts + 2)) / 2 - 1;
}

export function assemblePlan(
  episodes: EpisodeCandidate[],
  tracks: Track[],
  opts: { numberOfPodcasts: number; dryRun: boolean; now?: Date },
): DailyDrivePlan {
  const N = opts.numberOfPodcasts;
  if (episodes.length < N) {
    throw new InsufficientCandidatesError(
      `Need ${N} podcast episodes; only have ${episodes.length}`,
    );
  }
  const needed = songsNeeded(N);
  if (tracks.length < needed) {
    throw new InsufficientCandidatesError(
      `Need ${needed} unique songs for N=${N}; only have ${tracks.length}`,
    );
  }

  const items: PlanItem[] = [];
  let songCursor = 0;
  for (let n = 1; n <= N; n++) {
    items.push({ kind: 'podcast', episode: episodes[n - 1]!, slot: n });
    const songRunLength = n + 1;
    for (let s = 0; s < songRunLength; s++) {
      items.push({ kind: 'song', track: tracks[songCursor++]! });
    }
  }

  return {
    items,
    generated_at: (opts.now ?? new Date()).toISOString(),
    dry_run: opts.dryRun,
  };
}
