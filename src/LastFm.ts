import type { Track } from '@spotify/web-api-ts-sdk';
import _ from 'lodash';
import { spotifyClient } from './SpotifyClient.js';
import type { SourcedTrack } from './DailyDrivePlaylistItem.js';

const LASTFM_BASE = 'https://ws.audioscrobbler.com/2.0/';

type LastFmTrack = { name?: string; artist?: { name?: string } };

type TrackSimilarResponse = { similartracks?: { track?: LastFmTrack[] } };

interface Candidate {
  artistName: string;
  trackName: string;
  source: string;
}

export async function fetchLastFmDiscoveries(options: {
  seedTracks: Track[];
  numberOfTracks: number;
}): Promise<SourcedTrack[]> {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) {
    console.warn('LASTFM_API_KEY not set; skipping Last.fm discoveries.');
    return [];
  }

  const trackSeeds = _.sampleSize(options.seedTracks, 15);

  const candidates: Candidate[] = [];
  for (const seed of trackSeeds) {
    const artistName = seed.artists[0]?.name;
    const trackName = seed.name;
    if (!artistName || !trackName) continue;
    const similar = await lastFmGet<TrackSimilarResponse>(apiKey, 'track.getSimilar', {
      artist: artistName,
      track: trackName,
      limit: '30',
    });
    const tracks = similar?.similartracks?.track ?? [];
    for (const t of tracks) {
      if (!t.name || !t.artist?.name) continue;
      candidates.push({
        artistName: t.artist.name,
        trackName: t.name,
        source: `last.fm — similar track to "${trackName}"`,
      });
    }
  }

  const resolved: SourcedTrack[] = [];
  for (const c of candidates) {
    const hit = await searchSpotifyTrack(c.artistName, c.trackName);
    if (hit) resolved.push({ kind: 'track', track: hit, source: c.source });
  }

  return _(resolved)
    .uniqBy((st) => st.track.id)
    .sampleSize(options.numberOfTracks)
    .value();
}

async function lastFmGet<T>(
  apiKey: string,
  method: string,
  params: Record<string, string>,
): Promise<T | undefined> {
  const query = new URLSearchParams({ ...params, method, api_key: apiKey, format: 'json' });
  try {
    const res = await fetch(`${LASTFM_BASE}?${query.toString()}`);
    if (!res.ok) {
      console.error(`Last.fm ${method} failed: ${res.status}`);
      return undefined;
    }
    return (await res.json()) as T;
  } catch (e) {
    console.error(`Last.fm ${method} error:`, (e as Error).message);
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
