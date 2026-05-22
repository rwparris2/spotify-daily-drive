import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

export const TEST_USER_ID = 'test-user';

export const mswServer = setupServer(
  http.post('https://accounts.spotify.com/api/token', () =>
    HttpResponse.json({
      access_token: 'fake_access_token',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'user-read-playback-position',
    }),
  ),
  http.get('https://api.spotify.com/v1/me', () =>
    HttpResponse.json({ id: TEST_USER_ID, display_name: 'Test User' }),
  ),
);

type EpisodeFixture = {
  id: string;
  name: string;
  release_date: string;
  duration_ms?: number;
  fully_played?: boolean;
  is_playable?: boolean;
};

export function mockShowEpisodes(showId: string, episodes: EpisodeFixture[]): void {
  mswServer.use(
    http.get(`https://api.spotify.com/v1/shows/${showId}/episodes`, () =>
      HttpResponse.json({
        items: episodes.map((ep) => ({
          id: ep.id,
          name: ep.name,
          release_date: ep.release_date,
          duration_ms: ep.duration_ms ?? 30 * 60 * 1000,
          is_playable: ep.is_playable ?? true,
          resume_point: { fully_played: ep.fully_played ?? false, resume_position_ms: 0 },
        })),
        total: episodes.length,
        limit: 50,
        offset: 0,
        next: null,
        previous: null,
        href: '',
      }),
    ),
  );
}

export function mockShowEpisodesEmpty(showId: string): void {
  mockShowEpisodes(showId, []);
}

export function mockShowEpisodesError(
  showId: string,
  status = 429,
  retryAfterSeconds = 3600,
): void {
  mswServer.use(
    http.get(
      `https://api.spotify.com/v1/shows/${showId}/episodes`,
      () =>
        new HttpResponse('rate limited', {
          status,
          headers: { 'retry-after': String(retryAfterSeconds) },
        }),
    ),
  );
}

export type TrackFixture = {
  id: string;
  name?: string;
  artist?: string;
};

function trackJson(t: TrackFixture) {
  return {
    id: t.id,
    name: t.name ?? `Track ${t.id}`,
    artists: [{ name: t.artist ?? 'Artist', id: `${t.id}_artist` }],
    album: { name: 'Album', id: `${t.id}_album`, images: [] },
    duration_ms: 200_000,
    uri: `spotify:track:${t.id}`,
    type: 'track',
  };
}

export type PlaylistFixture = {
  id: string;
  name?: string;
  snapshot_id?: string;
  tracks: TrackFixture[];
};

export function mockUserPlaylists(playlists: PlaylistFixture[]): void {
  mswServer.use(
    http.get('https://api.spotify.com/v1/me/playlists', () =>
      HttpResponse.json({
        items: playlists.map((p) => ({
          id: p.id,
          name: p.name ?? `Playlist ${p.id}`,
          snapshot_id: p.snapshot_id ?? `${p.id}_snap`,
          owner: { id: TEST_USER_ID, display_name: 'Test User' },
        })),
        total: playlists.length,
        limit: 50,
        offset: 0,
        next: null,
        previous: null,
        href: '',
      }),
    ),
    ...playlists.map((p) =>
      http.get(`https://api.spotify.com/v1/playlists/${p.id}/items`, () =>
        HttpResponse.json({
          items: p.tracks.map((t) => ({ track: trackJson(t) })),
          total: p.tracks.length,
          limit: 50,
          offset: 0,
          next: null,
          previous: null,
          href: '',
        }),
      ),
    ),
  );
}

export function mockTopTracks(perHorizon: {
  short_term?: TrackFixture[];
  medium_term?: TrackFixture[];
  long_term?: TrackFixture[];
}): void {
  mswServer.use(
    http.get('https://api.spotify.com/v1/me/top/tracks', ({ request }) => {
      const url = new URL(request.url);
      const horizon = url.searchParams.get('time_range') as
        | 'short_term'
        | 'medium_term'
        | 'long_term'
        | null;
      const tracks = (horizon && perHorizon[horizon]) ?? [];
      return HttpResponse.json({
        items: tracks.map(trackJson),
        total: tracks.length,
        limit: 50,
        offset: 0,
        next: null,
        previous: null,
        href: '',
      });
    }),
  );
}

export function mockRecentlyPlayed(tracks: TrackFixture[]): void {
  mswServer.use(
    http.get('https://api.spotify.com/v1/me/player/recently-played', () =>
      HttpResponse.json({
        items: tracks.map((t) => ({ track: trackJson(t), played_at: new Date().toISOString() })),
        next: null,
        cursors: { after: '', before: '' },
        limit: 50,
        href: '',
      }),
    ),
  );
}

export function mockSavedTracks(tracks: TrackFixture[]): void {
  mswServer.use(
    http.get('https://api.spotify.com/v1/me/tracks', ({ request }) => {
      const url = new URL(request.url);
      const limit = Number(url.searchParams.get('limit') ?? 5);
      const offset = Number(url.searchParams.get('offset') ?? 0);
      const slice = tracks.slice(offset, offset + limit);
      return HttpResponse.json({
        items: slice.map((t) => ({ track: trackJson(t), added_at: new Date().toISOString() })),
        total: tracks.length,
        limit,
        offset,
        next: null,
        previous: null,
        href: '',
      });
    }),
  );
}
