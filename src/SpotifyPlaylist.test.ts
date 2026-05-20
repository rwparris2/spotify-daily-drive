import type { SimplifiedEpisode, Track } from '@spotify/web-api-ts-sdk';
import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { mswServer } from './__tests__/mswServer.js';
import type { DailyDrivePlaylistItem } from './DailyDrivePlaylistItem.js';
import { playlistDescription, playlistToUris, replacePlaylist } from './SpotifyPlaylist.js';

function ep(id: string): DailyDrivePlaylistItem {
  return {
    kind: 'episode',
    episode: {
      id,
      name: `Episode ${id}`,
      uri: `spotify:episode:${id}`,
    } as unknown as SimplifiedEpisode,
    source: 'podcasts.toml',
  };
}

function tr(id: string): DailyDrivePlaylistItem {
  return {
    kind: 'track',
    track: { id, name: `Track ${id}`, uri: `spotify:track:${id}` } as unknown as Track,
    source: 'top track - short_term',
  };
}

const samplePlaylist: DailyDrivePlaylistItem[] = [
  ep('e1'),
  tr('t1'),
  tr('t2'),
  ep('e2'),
  tr('t3'),
  tr('t4'),
  tr('t5'),
];

describe('playlistToUris', () => {
  it('emits spotify:episode and spotify:track uris in playlist order', () => {
    expect(playlistToUris(samplePlaylist)).toEqual([
      'spotify:episode:e1',
      'spotify:track:t1',
      'spotify:track:t2',
      'spotify:episode:e2',
      'spotify:track:t3',
      'spotify:track:t4',
      'spotify:track:t5',
    ]);
  });
});

describe('playlistDescription', () => {
  it('starts with "Daily Drive" and includes an ISO date', () => {
    const desc = playlistDescription();
    expect(desc).toMatch(/^Daily Drive · \d{4}-\d{2}-\d{2}/);
  });
});

describe('replacePlaylist', () => {
  it('PUTs the URI list then PUTs name + description', async () => {
    const observed: { uris?: string[]; details?: Record<string, unknown> } = {};

    mswServer.use(
      http.put('https://api.spotify.com/v1/playlists/playlist123/items', async ({ request }) => {
        const body = (await request.json()) as { uris: string[] };
        observed.uris = body.uris;
        return HttpResponse.json({ snapshot_id: 'snap_after_replace' });
      }),
      http.put('https://api.spotify.com/v1/playlists/playlist123', async ({ request }) => {
        observed.details = (await request.json()) as Record<string, unknown>;
        return new HttpResponse(null, { status: 200 });
      }),
    );

    await replacePlaylist('playlist123', samplePlaylist);

    expect(observed.uris).toEqual(playlistToUris(samplePlaylist));
    expect(observed.details?.name).toBe('Daily Drive');
    expect(observed.details?.description).toMatch(/^Daily Drive · \d{4}-\d{2}-\d{2}/);
  });

  it('PUTs the first 100 items then POSTs each subsequent chunk', async () => {
    const big: DailyDrivePlaylistItem[] = Array.from({ length: 250 }, (_, i) => tr(`b${i}`));
    const puts: string[][] = [];
    const posts: string[][] = [];

    mswServer.use(
      http.put('https://api.spotify.com/v1/playlists/playlist123/items', async ({ request }) => {
        puts.push(((await request.json()) as { uris: string[] }).uris);
        return HttpResponse.json({ snapshot_id: 'snap' });
      }),
      http.post('https://api.spotify.com/v1/playlists/playlist123/items', async ({ request }) => {
        posts.push(((await request.json()) as { uris: string[] }).uris);
        return HttpResponse.json({ snapshot_id: 'snap' });
      }),
      http.put('https://api.spotify.com/v1/playlists/playlist123', () => new HttpResponse(null, { status: 200 })),
    );

    await replacePlaylist('playlist123', big);

    expect(puts.length).toBe(1);
    expect(puts[0]!.length).toBe(100);
    expect(posts.length).toBe(2);
    expect(posts[0]!.length).toBe(100);
    expect(posts[1]!.length).toBe(50);
    expect([...puts[0]!, ...posts[0]!, ...posts[1]!]).toEqual(playlistToUris(big));
  });

  it('refuses to publish an empty playlist instead of issuing a no-op PUT', async () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('process.exit called');
    }) as never);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(replacePlaylist('playlist123', [])).rejects.toThrow(/process\.exit/);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Refusing to publish an empty playlist'));

    exitSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it('tags which phase failed when the replace PUT errors', async () => {
    mswServer.use(
      http.put('https://api.spotify.com/v1/playlists/playlist123/items', () =>
        new HttpResponse('boom', { status: 500 }),
      ),
    );
    await expect(replacePlaylist('playlist123', samplePlaylist)).rejects.toThrow(
      /Playlist replace \(PUT \/items\) failed/,
    );
  });

  it('tags which chunk failed when an append POST errors', async () => {
    const big: DailyDrivePlaylistItem[] = Array.from({ length: 150 }, (_, i) => tr(`c${i}`));
    mswServer.use(
      http.put('https://api.spotify.com/v1/playlists/playlist123/items', () =>
        HttpResponse.json({ snapshot_id: 'snap' }),
      ),
      http.post('https://api.spotify.com/v1/playlists/playlist123/items', () =>
        new HttpResponse('boom', { status: 500 }),
      ),
    );
    await expect(replacePlaylist('playlist123', big)).rejects.toThrow(
      /Playlist append chunk 2\/2 failed/,
    );
  });
});
