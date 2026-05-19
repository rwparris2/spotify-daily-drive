import _ from 'lodash';
import type { MaxInt } from '@spotify/web-api-ts-sdk';
import type { PodcastConfig } from './PodcastConfig.js';
import { spotifyClient } from './SpotifyClient.js';

export type EpisodeCandidate = {
  show_id: string;
  spotify_episode_id: string;
  title: string;
  release_date: string;
  duration_ms: number;
  fully_played: boolean;
};

export const NEWS_FRESHNESS_MS = 48 * 60 * 60 * 1000;
export const OTHER_FRESHNESS_MS = 90 * 24 * 60 * 60 * 1000;
export const EPISODES_PER_SHOW = 5;

export const NEWS_FALLBACK_CHAIN = [
  'NPR News Now',
  'Today Explained',
  'Throughline',
  'FiveThirtyEight Politics',
];

export type ShowConfig = PodcastConfig['shows'][number];

export type SkipReason =
  | 'show_not_in_config'
  | 'no_fresh_unplayed_episode'
  | 'pool_exhausted';

export type SkipLog = {
  slot?: number;
  show_name?: string;
  reason: SkipReason;
};

export type SelectPodcastSlotsResult = {
  episodes: EpisodeCandidate[];
  skipped: SkipLog[];
};

export type SelectPodcastSlotsOpts = {
  numberOfPodcasts: number;
  now?: Date;
  shuffle?: <T>(items: T[]) => T[];
};

export async function selectPodcastSlots(
  config: PodcastConfig,
  opts: SelectPodcastSlotsOpts,
): Promise<SelectPodcastSlotsResult> {
  const { numberOfPodcasts: N } = opts;
  const now = opts.now ?? new Date();
  const shuffle = opts.shuffle ?? _.shuffle;
  const skipped: SkipLog[] = [];
  const episodes: EpisodeCandidate[] = [];
  const used = new Set<string>();

  const otherPool = shuffle(
    config.shows.filter((s) => s.category === 'other' && s.pin_slot === undefined),
  );
  let otherCursor = 0;

  const pickFromOtherPool = async (): Promise<EpisodeCandidate | undefined> => {
    while (otherCursor < otherPool.length) {
      const show = otherPool[otherCursor++]!;
      if (used.has(show.spotify_show_id)) continue;
      const pick = await pickLatestEligible(show, OTHER_FRESHNESS_MS, now);
      if (pick) return pick;
      skipped.push({ show_name: show.name, reason: 'no_fresh_unplayed_episode' });
    }
    return undefined;
  };

  for (let slot = 1; slot <= N; slot++) {
    let pick: EpisodeCandidate | undefined;
    let primaryName: string | undefined;
    let reason: SkipReason | undefined;

    if (slot <= 2) {
      const primary = findByPinSlot(config, slot);
      if (primary) {
        primaryName = primary.name;
        const chain = buildNewsChain(config, primary, used);
        pick = await firstEligible(chain, NEWS_FRESHNESS_MS, now);
        if (!pick) reason = 'no_fresh_unplayed_episode';
      } else {
        reason = 'show_not_in_config';
      }
    }

    if (!pick) {
      pick = await pickFromOtherPool();
      if (!pick && reason === undefined) reason = 'pool_exhausted';
    }

    if (pick) {
      episodes.push(pick);
      used.add(pick.show_id);
    } else {
      skipped.push({ slot, show_name: primaryName, reason: reason ?? 'pool_exhausted' });
    }
  }

  return { episodes, skipped };
}

function findByPinSlot(config: PodcastConfig, slot: number): ShowConfig | undefined {
  return config.shows.find((s) => s.pin_slot === slot);
}

function findByName(config: PodcastConfig, name: string): ShowConfig | undefined {
  return config.shows.find((s) => s.name === name);
}

function buildNewsChain(
  config: PodcastConfig,
  primary: ShowConfig,
  exclude: Set<string>,
): ShowConfig[] {
  const chain: ShowConfig[] = [];
  if (!exclude.has(primary.spotify_show_id)) chain.push(primary);
  for (const name of NEWS_FALLBACK_CHAIN) {
    const show = findByName(config, name);
    if (!show) continue;
    if (show.spotify_show_id === primary.spotify_show_id) continue;
    if (exclude.has(show.spotify_show_id)) continue;
    chain.push(show);
  }
  return chain;
}

async function firstEligible(
  candidates: ShowConfig[],
  freshnessMs: number,
  now: Date,
): Promise<EpisodeCandidate | undefined> {
  for (const show of candidates) {
    const pick = await pickLatestEligible(show, freshnessMs, now);
    if (pick) return pick;
  }
  return undefined;
}

async function pickLatestEligible(
  show: ShowConfig,
  freshnessMs: number,
  now: Date,
): Promise<EpisodeCandidate | undefined> {
  const episodes = await fetchShowEpisodes(show.spotify_show_id, EPISODES_PER_SHOW);
  const cutoff = now.getTime() - freshnessMs;
  const eligible = episodes
    .filter((ep) => !ep.fully_played)
    .filter((ep) => Date.parse(ep.release_date) >= cutoff)
    .sort((a, b) => Date.parse(b.release_date) - Date.parse(a.release_date));
  return eligible[0];
}

async function fetchShowEpisodes(showId: string, limit: number): Promise<EpisodeCandidate[]> {
  const capped = Math.min(Math.max(limit, 1), 50) as MaxInt<50>;
  const page = await spotifyClient.shows.episodes(showId, 'US', capped);
  return page.items
    .filter((ep): ep is NonNullable<typeof ep> => ep !== null)
    .map((ep) => ({
      show_id: showId,
      spotify_episode_id: ep.id,
      title: ep.name,
      release_date: ep.release_date,
      duration_ms: ep.duration_ms,
      fully_played: ep.resume_point?.fully_played ?? false,
    }));
}
