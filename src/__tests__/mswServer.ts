import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

export const mswServer = setupServer(
  http.post('https://accounts.spotify.com/api/token', () =>
    HttpResponse.json({
      access_token: 'fake_access_token',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'user-read-playback-position',
    }),
  ),
);

type EpisodeFixture = {
  id: string;
  name: string;
  release_date: string;
  duration_ms?: number;
  fully_played?: boolean;
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
