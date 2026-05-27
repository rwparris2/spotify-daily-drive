import type { Track } from '@spotify/web-api-ts-sdk';
import _ from 'lodash';
import { spotifyClient } from './SpotifyClient.js';
import type { SourcedTrack } from './DailyDrivePlaylistItem.js';
import {
  getCachedListenBrainzTrack,
  setCachedListenBrainzTrack,
} from './ListenBrainzSpotifyCache.js';

const LB_BASE = 'https://api.listenbrainz.org';
const PLAYLIST_EXT_KEY = 'https://musicbrainz.org/doc/jspf#playlist';

type MusicBrainzId = string;

type ValidateTokenResponse = { valid: boolean; user_name?: string };

type JspfTrack = {
  creator?: string;
  title?: string;
  identifier?: string | string[];
};

type JspfPlaylist = {
  identifier?: string;
  extension?: {
    [PLAYLIST_EXT_KEY]?: {
      additional_metadata?: {
        algorithm_metadata?: { source_patch?: string };
      };
    };
  };
  track?: JspfTrack[];
};

type CreatedForResponse = { playlists?: { playlist?: JspfPlaylist }[] };
type PlaylistResponse = { playlist?: JspfPlaylist };

const PLAYLIST_SOURCES = [
  { sourcePatch: 'weekly-jams', label: 'listenbrainz weekly jams' },
  { sourcePatch: 'weekly-exploration', label: 'listenbrainz weekly exploration' },
] as const;

export async function fetchListenBrainzRecommendations(options: {
  numberOfTracks: number;
}): Promise<SourcedTrack[]> {
  const token = process.env.LISTENBRAINZ_USER_TOKEN;
  if (!token) {
    console.warn('LISTENBRAINZ_USER_TOKEN not set; skipping ListenBrainz recommendations.');
    return [];
  }

  const username = await validateListenBrainzToken(token);
  if (!username) return [];

  const createdFor = await fetchCreatedForPlaylists(username);
  if (createdFor.length === 0) return [];

  const collected: SourcedTrack[] = [];
  let cacheHits = 0;
  let cacheMisses = 0;

  for (const { sourcePatch, label } of PLAYLIST_SOURCES) {
    const match = createdFor.find(
      (p) =>
        p.extension?.[PLAYLIST_EXT_KEY]?.additional_metadata?.algorithm_metadata?.source_patch ===
        sourcePatch,
    );
    if (!match) {
      console.warn(`ListenBrainz: no "${sourcePatch}" playlist found for ${username}.`);
      continue;
    }
    const playlistMbid = extractPlaylistMbid(match.identifier);
    if (!playlistMbid) continue;

    const jspfTracks = await fetchPlaylistTracks(playlistMbid);
    for (const jspf of jspfTracks) {
      const resolved = await resolveJspfTrack(jspf, label);
      if (!resolved) continue;
      if (resolved.fromCache) cacheHits += 1;
      else cacheMisses += 1;
      if (resolved.sourcedTrack) collected.push(resolved.sourcedTrack);
    }
  }

  if (cacheHits > 0 || cacheMisses > 0) {
    console.log(`ListenBrainz cache: ${cacheHits} hit(s), ${cacheMisses} miss(es)`);
  }

  return _(collected)
    .chain()
    .uniqBy((t) => t.track.id)
    .sampleSize(options.numberOfTracks)
    .value();
}

type ResolvedJspf = { sourcedTrack: SourcedTrack | undefined; fromCache: boolean };

async function resolveJspfTrack(jspf: JspfTrack, source: string): Promise<ResolvedJspf | undefined> {
  const mbid = extractRecordingMbid(jspf.identifier);
  const artist = jspf.creator;
  const title = jspf.title;
  if (!mbid || !artist || !title) return undefined;

  const cached = await getCachedListenBrainzTrack(mbid);
  if (cached !== undefined) {
    return {
      sourcedTrack: cached ? { kind: 'track', track: cached, source } : undefined,
      fromCache: true,
    };
  }

  const hit = await searchSpotifyTrack(artist, title);
  await persistCacheEntry(mbid, hit ?? null);
  return {
    sourcedTrack: hit ? { kind: 'track', track: hit, source } : undefined,
    fromCache: false,
  };
}

function extractRecordingMbid(identifier?: string | string[]): MusicBrainzId | undefined {
  const candidates = Array.isArray(identifier) ? identifier : identifier ? [identifier] : [];
  for (const c of candidates) {
    const m = c.match(/musicbrainz\.org\/recording\/([0-9a-f-]{36})/i);
    if (m) return m[1];
  }
  return undefined;
}

function extractPlaylistMbid(identifier?: string): MusicBrainzId | undefined {
  if (!identifier) return undefined;
  return identifier.match(/listenbrainz\.org\/playlist\/([0-9a-f-]{36})/i)?.[1];
}

async function fetchCreatedForPlaylists(username: string): Promise<JspfPlaylist[]> {
  try {
    const res = await fetch(
      `${LB_BASE}/1/user/${encodeURIComponent(username)}/playlists/createdfor?count=25`,
    );
    if (!res.ok) {
      console.error(`ListenBrainz createdfor failed: ${res.status}`);
      return [];
    }
    const data = (await res.json()) as CreatedForResponse;
    return (data.playlists ?? []).map((p) => p.playlist).filter((p): p is JspfPlaylist => !!p);
  } catch (e) {
    console.error('ListenBrainz createdfor error:', (e as Error).message);
    return [];
  }
}

async function fetchPlaylistTracks(playlistMbid: MusicBrainzId): Promise<JspfTrack[]> {
  try {
    const res = await fetch(`${LB_BASE}/1/playlist/${playlistMbid}`);
    if (!res.ok) {
      console.error(`ListenBrainz playlist ${playlistMbid} failed: ${res.status}`);
      return [];
    }
    const data = (await res.json()) as PlaylistResponse;
    return data.playlist?.track ?? [];
  } catch (e) {
    console.error(`ListenBrainz playlist ${playlistMbid} error:`, (e as Error).message);
    return [];
  }
}

async function persistCacheEntry(mbid: MusicBrainzId, value: Track | null): Promise<void> {
  try {
    await setCachedListenBrainzTrack(mbid, value);
  } catch (e) {
    console.error(
      `Failed to persist ListenBrainz→Spotify cache for mbid ${mbid}:`,
      (e as Error).message,
    );
  }
}

async function validateListenBrainzToken(token: string): Promise<string | undefined> {
  try {
    const res = await fetch(`${LB_BASE}/1/validate-token`, {
      headers: { Authorization: `Token ${token}` },
    });
    if (!res.ok) {
      console.error(`ListenBrainz token validation failed: ${res.status}`);
      return undefined;
    }
    const data = (await res.json()) as ValidateTokenResponse;
    if (!data.valid || !data.user_name) {
      console.error('ListenBrainz token is invalid.');
      return undefined;
    }
    return data.user_name;
  } catch (e) {
    console.error('ListenBrainz token validation error:', (e as Error).message);
    return undefined;
  }
}

async function searchSpotifyTrack(
  artistName: string,
  trackName: string,
): Promise<Track | undefined> {
  const safeTrack = trackName.replace(/"/g, '');
  const safeArtist = artistName.replace(/"/g, '');
  const query = `track:"${safeTrack}" artist:"${safeArtist}"`;
  try {
    const result = await spotifyClient.search(query, ['track'], undefined, 1);
    return result.tracks?.items?.[0];
  } catch (e) {
    console.error(
      `Spotify search failed for "${trackName}" by ${artistName}:`,
      (e as Error).message,
    );
    return undefined;
  }
}
