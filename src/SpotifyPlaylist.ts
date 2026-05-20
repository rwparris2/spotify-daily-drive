import _ from 'lodash';
import { spotifyClient } from './SpotifyClient.js';
import { DailyDrivePlaylistItem } from './DailyDrivePlaylistItem.js';

export function playlistToUris(playlist: DailyDrivePlaylistItem[]): string[] {
  return playlist.map((it) => {
    switch (it.kind) {
      case 'episode':
        return `spotify:episode:${it.episode.id}`;
      case 'track':
        return `spotify:track:${it.track.id}`;
    }
  });
}

export function playlistDescription(): string {
  const date = new Date().toISOString().slice(0, 10);
  return `Daily Drive · ${date}`;
}

export async function replacePlaylist(
  playlistId: string,
  playlist: DailyDrivePlaylistItem[],
): Promise<void> {
  const uris = playlistToUris(playlist);
  if (uris.length === 0) {
    console.error(
      'Refusing to publish an empty playlist — PUT /items with [] is a no-op on Spotify ' +
        'and would leave yesterday\'s items in place under today\'s title. ' +
        'Check upstream fetch errors and re-run.',
    );
    process.exit(1);
  }
  const [first, ...rest] = _.chunk(uris, 100);
  try {
    await spotifyClient.makeRequest('PUT', `playlists/${playlistId}/items`, { uris: first ?? [] });
  } catch (e) {
    throw new Error(
      `Playlist replace (PUT /items) failed — playlist may now be empty: ${(e as Error).message}`,
      { cause: e },
    );
  }
  for (const [i, chunk] of rest.entries()) {
    try {
      await spotifyClient.makeRequest('POST', `playlists/${playlistId}/items`, { uris: chunk });
    } catch (e) {
      throw new Error(
        `Playlist append chunk ${i + 2}/${rest.length + 1} failed — playlist is truncated at ~${(i + 1) * 100} items: ${(e as Error).message}`,
        { cause: e },
      );
    }
  }
  try {
    await spotifyClient.makeRequest('PUT', `playlists/${playlistId}`, {
      name: 'Daily Drive',
      description: playlistDescription(),
    });
  } catch (e) {
    throw new Error(
      `Playlist rename failed — tracks were written but title/description are stale: ${(e as Error).message}`,
      { cause: e },
    );
  }
}
