import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import type { Track } from '@spotify/web-api-ts-sdk';

const CACHE_PATH = process.env.LASTFM_SPOTIFY_CACHE_PATH ?? '.cache/lastfm-spotify-tracks.json';

type CacheValue = Track | null;
type CacheShape = Record<string, CacheValue>;

let cache: CacheShape | undefined;

function cacheKey(artistName: string, trackName: string): string {
  return JSON.stringify([artistName.trim().toLowerCase(), trackName.trim().toLowerCase()]);
}

async function load(): Promise<CacheShape> {
  if (cache) return cache;
  let raw: string;
  try {
    raw = await readFile(CACHE_PATH, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') {
      cache = {};
      return cache;
    }
    throw new Error(
      `Failed to read Last.fm→Spotify cache at ${CACHE_PATH}: ${(e as Error).message}`,
      { cause: e },
    );
  }
  try {
    cache = JSON.parse(raw) as CacheShape;
  } catch (e) {
    throw new Error(
      `Last.fm→Spotify cache at ${CACHE_PATH} is corrupt (${(e as Error).message}). ` +
        `Delete the file to rebuild from scratch.`,
      { cause: e },
    );
  }
  return cache;
}

async function persist(): Promise<void> {
  if (!cache) return;
  await mkdir(dirname(CACHE_PATH), { recursive: true });
  await writeFile(CACHE_PATH, JSON.stringify(cache, null, 2), 'utf8');
}

export async function getCachedLastFmTrack(
  artistName: string,
  trackName: string,
): Promise<Track | null | undefined> {
  const store = await load();
  const key = cacheKey(artistName, trackName);
  return key in store ? store[key] : undefined;
}

export async function setCachedLastFmTrack(
  artistName: string,
  trackName: string,
  track: Track | null,
): Promise<void> {
  const store = await load();
  store[cacheKey(artistName, trackName)] = track;
  await persist();
}
