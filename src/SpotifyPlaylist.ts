import _ from 'lodash';
import { spotifyClient } from './SpotifyClient.js';
import { PlaylistItem } from './PlaylistItem.js';

function isNotUndefined<T>(input: T | undefined): input is T {
  return input !== undefined;
}

export function playlistToUris(playlist: PlaylistItem[]): string[] {
  return playlist
    .map((it) => {
      if ('episode' in it) {
        return `spotify:episode:${it.episode.id}`;
      } else if ('track' in it) {
        return `spotify:track:${it.track.id}`;
      }
    })
    .filter(isNotUndefined);
}

export function playlistDescription(): string {
  const date = new Date().toISOString().slice(0, 10);
  return `Daily Drive · ${date}}`;
}

export async function replacePlaylist(playlistId: string, playlist: PlaylistItem[]): Promise<void> {
  const uris = playlistToUris(playlist);
  const [first, ...rest] = _.chunk(uris, 100);
  await spotifyClient.playlists.updatePlaylistItems(playlistId, { uris: first ?? [] });
  for (const chunk of rest) {
    await spotifyClient.playlists.addItemsToPlaylist(playlistId, chunk);
  }
  await spotifyClient.playlists.changePlaylistDetails(playlistId, {
    name: 'Daily Drive',
    description: playlistDescription(),
  });
}
