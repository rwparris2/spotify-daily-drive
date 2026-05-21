import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import type { Track } from '@spotify/web-api-ts-sdk';

const CACHE_PATH =
  process.env.LISTENBRAINZ_SPOTIFY_CACHE_PATH ?? '.cache/listenbrainz-spotify-tracks.json';

type CacheValue = Track | null;
type CacheShape = Record<string, CacheValue>;

let cache: CacheShape | undefined;

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
      `Failed to read ListenBrainz→Spotify cache at ${CACHE_PATH}: ${(e as Error).message}`,
      { cause: e },
    );
  }
  try {
    cache = JSON.parse(raw) as CacheShape;
  } catch (e) {
    throw new Error(
      `ListenBrainz→Spotify cache at ${CACHE_PATH} is corrupt (${(e as Error).message}). ` +
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

export async function getCachedListenBrainzTrack(
  mbid: string,
): Promise<Track | null | undefined> {
  const store = await load();
  return mbid in store ? store[mbid] : undefined;
}

export async function setCachedListenBrainzTrack(
  mbid: string,
  track: Track | null,
): Promise<void> {
  const store = await load();
  store[mbid] = track;
  await persist();
}
