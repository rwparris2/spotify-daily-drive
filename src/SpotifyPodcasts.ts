import _ from 'lodash';
import type { SimplifiedEpisode } from '@spotify/web-api-ts-sdk';
import { loadPodcastConfig, type PodcastConfig } from './PodcastConfig.js';
import { spotifyClient } from './SpotifyClient.js';
import type { SourcedEpisode } from './DailyDrivePlaylistItem.js';

type PodcastShowConfig = PodcastConfig['shows'][number];

const RELEASE_CUTOFF_MONTHS = 6;

export const fetchSpotifyPodcasts = async (opts: {
  numberOfPodcasts: number;
}): Promise<SourcedEpisode[]> => {
  const config = await loadPodcastConfig();

  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - RELEASE_CUTOFF_MONTHS);

  const usedShowIds = new Set<string>();
  const exhaustedShowIds = new Set<string>();
  const selected: SourcedEpisode[] = [];

  const tryPick = async (
    filter: (s: PodcastShowConfig) => boolean,
  ): Promise<SimplifiedEpisode | undefined> => {
    const pool = config.shows.filter(
      (s) =>
        filter(s) &&
        !usedShowIds.has(s.spotify_show_id) &&
        !exhaustedShowIds.has(s.spotify_show_id),
    );
    while (pool.length) {
      const idx = _.random(pool.length - 1);
      const show = pool.splice(idx, 1)[0]!;
      const episode = await pickLatestEligibleEpisode(show, cutoff);
      if (episode) {
        usedShowIds.add(show.spotify_show_id);
        return episode;
      }
      exhaustedShowIds.add(show.spotify_show_id);
    }
    return undefined;
  };

  for (let slot = 1; slot <= opts.numberOfPodcasts; slot++) {
    const pinned = await tryPick((s) => s.pin_slot === slot);
    const episode = pinned ?? (await tryPick((s) => s.pin_slot === undefined));
    if (episode) selected.push({ kind: 'episode', episode, source: 'podcasts.toml' });
  }

  return selected;
};

async function pickLatestEligibleEpisode(
  show: PodcastShowConfig,
  cutoff: Date,
): Promise<SimplifiedEpisode | undefined> {
  let episodes: SimplifiedEpisode[];
  try {
    const page = await spotifyClient.shows.episodes(show.spotify_show_id, 'US', 25);
    episodes = page.items;
  } catch (e) {
    console.error(`Error fetching episodes for "${show.name}":`, (e as Error).message);
    return undefined;
  }
  const playable = episodes
    .filter((ep): ep is SimplifiedEpisode => ep != null && ep.is_playable)
    .sort((a, b) => Date.parse(b.release_date) - Date.parse(a.release_date));

  if (show.latest_only) {
    const newest = playable[0];
    if (!newest || (newest.resume_point?.fully_played ?? false)) return undefined;
    return newest;
  }

  return playable
    .filter((ep) => Date.parse(ep.release_date) >= cutoff.getTime())
    .filter((ep) => !(ep.resume_point?.fully_played ?? false))[0];
}
