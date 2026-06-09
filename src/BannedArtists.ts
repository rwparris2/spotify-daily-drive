import { readFile } from 'fs/promises';
import { parse } from 'smol-toml';
import type { Track } from '@spotify/web-api-ts-sdk';
import { BANNED_ARTISTS_CONFIG_PATH } from './config.js';
import type { SourcedTrack } from './DailyDrivePlaylistItem.js';

export type BannedArtists = {
  names: Set<string>;
  ids: Set<string>;
};

function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

export function createBannedArtists(input: { names?: string[]; ids?: string[] }): BannedArtists {
  return {
    names: new Set((input.names ?? []).map(normalizeName)),
    ids: new Set(input.ids ?? []),
  };
}

export function isTrackBanned(track: Track, banned: BannedArtists): boolean {
  return track.artists.some(
    (artist) => banned.names.has(normalizeName(artist.name)) || banned.ids.has(artist.id),
  );
}

export function filterBannedTracks(
  tracks: SourcedTrack[],
  banned: BannedArtists,
): { kept: SourcedTrack[]; removed: SourcedTrack[] } {
  const kept: SourcedTrack[] = [];
  const removed: SourcedTrack[] = [];
  for (const sourced of tracks) {
    (isTrackBanned(sourced.track, banned) ? removed : kept).push(sourced);
  }
  return { kept, removed };
}

type BannedArtistsConfig = { names?: string[]; ids?: string[] };

export async function loadBannedArtists(
  configPath: string = BANNED_ARTISTS_CONFIG_PATH,
): Promise<BannedArtists> {
  let tomlText: string;
  try {
    tomlText = await readFile(configPath, 'utf8');
  } catch {
    // No ban list configured is a valid state — fall back to banning nothing.
    return createBannedArtists({});
  }

  try {
    const config = parse(tomlText) as BannedArtistsConfig;
    return createBannedArtists({ names: config.names, ids: config.ids });
  } catch (e) {
    console.error(`Failed to parse banned-artists config at ${configPath}:`, (e as Error).message);
    return createBannedArtists({});
  }
}
