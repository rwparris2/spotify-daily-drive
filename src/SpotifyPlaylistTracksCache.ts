import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import type { Track } from '@spotify/web-api-ts-sdk';

const CACHE_DIR = process.env.SPOTIFY_PLAYLIST_TRACKS_CACHE_DIR ?? '.cache/spotify-playlist-tracks';

type CacheEntry = { snapshotId: string; tracks: Track[] };

// One file per playlist, named by its Spotify id (base-62, always filename-safe).
// Keeping playlists in separate files means a run only rewrites the playlists that
// actually changed, so the committed cache produces small git diffs instead of one
// multi-megabyte blob churning on every run.
function fileFor(playlistId: string): string {
  return join(CACHE_DIR, `${playlistId}.json`);
}

export async function getCachedPlaylistTracks(
  playlistId: string,
  currentSnapshotId: string,
): Promise<Track[] | undefined> {
  const path = fileFor(playlistId);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new Error(`Failed to read playlist tracks cache at ${path}: ${(e as Error).message}`, {
      cause: e,
    });
  }
  let entry: CacheEntry;
  try {
    entry = JSON.parse(raw) as CacheEntry;
  } catch (e) {
    throw new Error(
      `Playlist tracks cache at ${path} is corrupt (${(e as Error).message}). ` +
        `Delete the file to rebuild it from scratch.`,
      { cause: e },
    );
  }
  return entry.snapshotId === currentSnapshotId ? entry.tracks : undefined;
}

export async function setCachedPlaylistTracks(
  playlistId: string,
  snapshotId: string,
  tracks: Track[],
): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  const entry: CacheEntry = { snapshotId, tracks };
  await writeFile(fileFor(playlistId), JSON.stringify(entry, null, 2), 'utf8');
}
