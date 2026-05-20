import type { Track } from '@spotify/web-api-ts-sdk';
import { spotifyClient } from './SpotifyClient.js';
import type { SourcedTrack } from './DailyDrivePlaylistItem.js';

const LB_BASE = 'https://api.listenbrainz.org';

type MusicBrainzId = string;

type ValidateTokenResponse = { valid: boolean; user_name?: string };
type RecommendationsResponse = {
  payload?: { mbids?: { recording_mbid: MusicBrainzId; score: number }[] };
};
type RecordingMetadata = {
  recording?: { name?: string };
  artist?: { name?: string };
};
type MetadataResponse = Record<MusicBrainzId, RecordingMetadata | undefined>;

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

  const musicBrainzIds = await fetchRecommendations(username, options.numberOfTracks * 3);
  if (musicBrainzIds.length === 0) return [];

  const metadata = await fetchRecordingMetadata(musicBrainzIds);

  const tracks: SourcedTrack[] = [];
  for (const musicBrainzId of musicBrainzIds) {
    if (tracks.length >= options.numberOfTracks) break;
    const meta = metadata[musicBrainzId];
    const artistName = meta?.artist?.name;
    const trackName = meta?.recording?.name;
    if (!artistName || !trackName) continue;
    const hit = await searchSpotifyTrack(artistName, trackName);
    if (hit) tracks.push({ track: hit, source: 'listenbrainz suggestion' });
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

async function fetchRecommendations(username: string, count: number): Promise<MusicBrainzId[]> {
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
    const musicBrainzIds = data.payload?.mbids?.map((m) => m.recording_mbid) ?? [];
    if (musicBrainzIds.length === 0) {
      console.warn(`ListenBrainz returned no recommendations for "${username}".`);
    }
    return musicBrainzIds;
  } catch (e) {
    console.error('ListenBrainz recommendations error:', (e as Error).message);
    return [];
  }
}

async function fetchRecordingMetadata(
  musicBrainzIds: MusicBrainzId[],
): Promise<MetadataResponse> {
  try {
    const res = await fetch(
      `${LB_BASE}/1/metadata/recording?recording_mbids=${musicBrainzIds.join(',')}&inc=artist`,
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
