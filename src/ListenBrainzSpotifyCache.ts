import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import type { Track } from '@spotify/web-api-ts-sdk';

const DEFAULT_PATH = '.cache/listenbrainz-spotify-tracks.json';

type CacheValue = Track | null;
type CacheShape = Record<string, CacheValue>;

let cache: CacheShape | undefined;
let cachedFromPath: string | undefined;

function currentPath(): string {
  return process.env.LISTENBRAINZ_SPOTIFY_CACHE_PATH ?? DEFAULT_PATH;
}

async function load(): Promise<CacheShape> {
  const path = currentPath();
  if (cache !== undefined && cachedFromPath === path) return cache;
  // First load, or the configured path changed since last load — read fresh.
  cachedFromPath = path;
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      cache = {};
      return cache;
    }
    throw new Error(
      `Failed to read ListenBrainz→Spotify cache at ${path}: ${(e as Error).message}`,
      { cause: e },
    );
  }
  try {
    cache = JSON.parse(raw) as CacheShape;
  } catch (e) {
    throw new Error(
      `ListenBrainz→Spotify cache at ${path} is corrupt (${(e as Error).message}). ` +
        `Delete the file to rebuild from scratch.`,
      { cause: e },
    );
  }
  return cache;
}

async function persist(): Promise<void> {
  if (!cache) return;
  const path = currentPath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(cache, null, 2), 'utf8');
}

export function resetCacheForTest(): void {
  cache = undefined;
  cachedFromPath = undefined;
}

export async function getCachedListenBrainzTrack(mbid: string): Promise<Track | null | undefined> {
  const store = await load();
  return mbid in store ? store[mbid] : undefined;
}

export async function setCachedListenBrainzTrack(mbid: string, track: Track | null): Promise<void> {
  const store = await load();
  store[mbid] = track;
  await persist();
}
