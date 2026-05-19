import type { Track } from '@spotify/web-api-ts-sdk';
import { spotifyClient } from './SpotifyClient.js';

const LB_BASE = 'https://api.listenbrainz.org';

type ValidateTokenResponse = { valid: boolean; user_name?: string };
type RecommendationsResponse = {
  payload?: { mbids?: { recording_mbid: string; score: number }[] };
};
type RecordingMetadata = {
  recording?: { name?: string };
  artist?: { name?: string };
};
type MetadataResponse = Record<string, RecordingMetadata | undefined>;

export async function fetchListenBrainzRecommendations(options: {
  numberOfTracks: number;
}): Promise<Track[]> {
  const token = process.env.LISTENBRAINZ_USER_TOKEN;
  if (!token) {
    console.warn('LISTENBRAINZ_USER_TOKEN not set; skipping ListenBrainz recommendations.');
    return [];
  }

  const username = await validateListenBrainzToken(token);
  if (!username) return [];

  const mbids = await fetchRecommendationMbids(username, options.numberOfTracks * 3);
  if (mbids.length === 0) return [];

  const metadata = await fetchRecordingMetadata(mbids);

  console.log(mbids);
  console.log(metadata);

  const tracks: Track[] = [];
  for (const mbid of mbids) {
    if (tracks.length >= options.numberOfTracks) break;
    const meta = metadata[mbid];
    const artistName = meta?.artist?.name;
    const trackName = meta?.recording?.name;
    if (!artistName || !trackName) continue;
    const hit = await searchSpotifyTrack(artistName, trackName);
    if (hit) tracks.push(hit);
  }

  return tracks;
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

async function fetchRecommendationMbids(username: string, count: number): Promise<string[]> {
  try {
    const res = await fetch(
      `${LB_BASE}/1/cf/recommendation/user/${encodeURIComponent(username)}/recording?count=${count}`,
    );
    if (!res.ok) {
      console.error(`ListenBrainz recommendations failed: ${res.status}`);
      return [];
    }
    const text = await res.text();
    if (!text) {
      console.warn(
        `ListenBrainz has no collaborative-filter recommendations for "${username}" yet ` +
          `(empty body). Scrobble more listens to enable, or wait for the model to retrain.`,
      );
      return [];
    }
    const data = JSON.parse(text) as RecommendationsResponse;
    const mbids = data.payload?.mbids?.map((m) => m.recording_mbid) ?? [];
    if (mbids.length === 0) {
      console.warn(`ListenBrainz returned no recommendations for "${username}".`);
    }
    return mbids;
  } catch (e) {
    console.error('ListenBrainz recommendations error:', (e as Error).message);
    return [];
  }
}

async function fetchRecordingMetadata(mbids: string[]): Promise<MetadataResponse> {
  try {
    const res = await fetch(
      `${LB_BASE}/1/metadata/recording?recording_mbids=${mbids.join(',')}&inc=artist`,
    );
    if (!res.ok) {
      console.error(`ListenBrainz metadata failed: ${res.status}`);
      return {};
    }
    return (await res.json()) as MetadataResponse;
  } catch (e) {
    console.error('ListenBrainz metadata error:', (e as Error).message);
    return {};
  }
}

async function searchSpotifyTrack(
  artistName: string,
  trackName: string,
): Promise<Track | undefined> {
  const query = `track:"${trackName}" artist:"${artistName}"`;
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
