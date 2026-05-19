import _ from 'lodash';
import type { DailyDrivePlan } from './DailyDrivePlan.js';
import { spotifyClient } from './SpotifyClient.js';

export function planToUris(plan: DailyDrivePlan): string[] {
  return plan.items.map((it) =>
    it.kind === 'podcast'
      ? `spotify:episode:${it.episode.spotify_episode_id}`
      : `spotify:track:${it.track.id}`,
  );
}

export function planDescription(plan: DailyDrivePlan): string {
  const date = plan.generated_at.slice(0, 10);
  const showNames = _(plan.items)
    .chain()
    .filter((it): it is Extract<typeof it, { kind: 'podcast' }> => it.kind === 'podcast')
    .map((it) => it.episode.show_name)
    .uniq()
    .value();
  return `Daily Drive · ${date} · ${showNames.join(', ')}`;
}

export async function replacePlaylist(playlistId: string, plan: DailyDrivePlan): Promise<void> {
  const uris = planToUris(plan);
  const [first, ...rest] = _.chunk(uris, 100);
  await spotifyClient.playlists.updatePlaylistItems(playlistId, { uris: first ?? [] });
  for (const chunk of rest) {
    await spotifyClient.playlists.addItemsToPlaylist(playlistId, chunk);
  }
  await spotifyClient.playlists.changePlaylistDetails(playlistId, {
    name: 'Daily Drive',
    description: planDescription(plan),
  });
}
