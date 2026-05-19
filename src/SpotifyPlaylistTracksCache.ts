import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import type { Track } from '@spotify/web-api-ts-sdk';

const CACHE_PATH = '.cache/spotify-playlist-tracks.json';

type CacheEntry = { snapshotId: string; tracks: Track[] };
type CacheShape = Record<string, CacheEntry>;

let cache: CacheShape | undefined;

async function load(): Promise<CacheShape> {
  if (cache) return cache;
  try {
    const raw = await readFile(CACHE_PATH, 'utf8');
    cache = JSON.parse(raw) as CacheShape;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    cache = {};
  }
  return cache;
}

async function persist(): Promise<void> {
  if (!cache) return;
  await mkdir(dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
}

export async function getCachedPlaylistTracks(
  playlistId: string,
  currentSnapshotId: string,
): Promise<Track[] | undefined> {
  const store = await load();
  const entry = store[playlistId];
  return entry?.snapshotId === currentSnapshotId ? entry.tracks : undefined;
}

export async function setCachedPlaylistTracks(
  playlistId: string,
  snapshotId: string,
  tracks: Track[],
): Promise<void> {
  const store = await load();
  store[playlistId] = { snapshotId, tracks };
  await persist();
}
