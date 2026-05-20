import { Page, SimplifiedPlaylist, Track } from '@spotify/web-api-ts-sdk';
import { spotifyClient } from './SpotifyClient.js';
import { getCachedPlaylistTracks, setCachedPlaylistTracks } from './SpotifyPlaylistTracksCache.js';
import { fetchListenBrainzRecommendations } from './ListenBrainz.js';
import _ from 'lodash';
import { SPOTIFY_PLAYLIST_ID } from './config.js';
import type { SourcedTrack } from './DailyDrivePlaylistItem.js';

async function fetchAllPlaylists<T>(): Promise<SimplifiedPlaylist[]> {
  const pageSize = 50;
  let currentPage = 0;
  let hasNextPage = true;

  let results: SimplifiedPlaylist[] = [];
  while (hasNextPage) {
    try {
      const page = await spotifyClient.currentUser.playlists.playlists(
        pageSize,
        currentPage * pageSize,
      );
      results = [...results, ...page.items];
      hasNextPage = !!page.next;
      currentPage += 1;
    } catch (e) {
      console.error('Error fetching playlists', e);
      hasNextPage = false;
    }
  }

  // Excluding the target playlist prevents yesterday's Daily Drive from seeding today's.
  results = results.filter((p) => p.id != SPOTIFY_PLAYLIST_ID);

  // Spotify-owned algorithmic playlists (Daily Mix, Discover Weekly, etc.) return 404 on
  // /playlists/{id}/items for third-party apps; filtering by owner avoids one error per playlist.
  results = results.filter((p) => p.owner?.id !== 'spotify');

  return results;
}

type PlaylistItemsPage = Page<{ item?: Track | null; track?: Track | null }>;

async function fetchSongsFromPlayList(
  playlistId: string,
): Promise<{ tracks: Track[]; complete: boolean }> {
  const pageSize = 50;
  let currentPage = 0;
  let hasNextPage = true;
  let complete = true;

  let results: Track[] = [];
  while (hasNextPage) {
    try {
      const page = await spotifyClient.makeRequest<PlaylistItemsPage>(
        'GET',
        `playlists/${playlistId}/items?limit=${pageSize}&offset=${currentPage * pageSize}`,
      );
      const pageTracks = page.items
        .map((x) => x.item ?? x.track)
        .filter((t): t is Track => t != null && t.type === 'track');
      results = [...results, ...pageTracks];
      hasNextPage = !!page.next;
      currentPage += 1;
    } catch (e) {
      console.error('Error fetching playlist songs', e);
      hasNextPage = false;
      complete = false;
    }
  }

  return { tracks: results, complete };
}

async function playlistTracks(options: { numberOfTracks: number }): Promise<SourcedTrack[]> {
  const playlists = await fetchAllPlaylists();
  const playlistsToFetch = _.sampleSize(
    playlists,
    Math.min(3, Math.ceil(options.numberOfTracks / 3)),
  );
  let results: SourcedTrack[] = [];
  for (const p of playlistsToFetch) {
    const source = `user playlist - ${p.name}`;
    const cached = await getCachedPlaylistTracks(p.id, p.snapshot_id);
    if (cached) {
      console.log(`Cache hit for ${p.name} (${cached.length} tracks)`);
      results = [...results, ...cached.map((track): SourcedTrack => ({ kind: 'track', track, source }))];
      continue;
    }
    const { tracks, complete } = await fetchSongsFromPlayList(p.id);
    if (complete) {
      try {
        await setCachedPlaylistTracks(p.id, p.snapshot_id, tracks);
      } catch (e) {
        console.error(
          `Failed to persist cache for playlist "${p.name}" (${p.id}):`,
          (e as Error).message,
        );
      }
    }
    results = [...results, ...tracks.map((track): SourcedTrack => ({ kind: 'track', track, source }))];
  }
  return _(results)
    .chain()
    .uniqBy((t) => t.track.id)
    .sampleSize(options.numberOfTracks)
    .value();
}

async function topTracks(options: { numberOfTracks: number }): Promise<SourcedTrack[]> {
  const terms = ['short_term', 'medium_term', 'long_term'] as const;
  const allTopItems: SourcedTrack[] = [];
  for (const term of terms) {
    try {
      const page = await spotifyClient.currentUser.topItems('tracks', term, 50);
      for (const track of page.items) {
        allTopItems.push({ kind: 'track', track, source: `top track - ${term}` });
      }
    } catch (e) {
      console.error(`Error fetching topTracks ${term}`, e);
    }
  }

  return _(allTopItems)
    .chain()
    .uniqBy((t) => t.track.id)
    .sampleSize(options.numberOfTracks)
    .value();
}

async function recentlyPlayedTracks(options: {
  numberOfTracks: number;
}): Promise<SourcedTrack[]> {
  let tracks: Track[] = [];
  try {
    tracks = await spotifyClient.player
      .getRecentlyPlayedTracks(50)
      .then((page) => page.items)
      .then((items) => items.map((i) => i.track));
  } catch (e) {
    console.error('Error fetching recently played tracks', e);
  }

  return _(tracks)
    .chain()
    .uniqBy((t) => t.id)
    .map((track): SourcedTrack => ({ kind: 'track', track, source: 'recently listened' }))
    .sampleSize(options.numberOfTracks)
    .value();
}

async function savedTracks(options: { numberOfTracks: number }): Promise<SourcedTrack[]> {
  let totalSavedTracks = 0;
  try {
    totalSavedTracks = await spotifyClient.currentUser.tracks.savedTracks(1).then((r) => r.total);
  } catch (e) {
    console.error('Error fetching saved tracks', e);
  }

  const pageSize = 5;
  const pages = Math.ceil(totalSavedTracks / pageSize);
  const pagesToFetch = _.sampleSize(_.range(0, pages), 5);
  let results: Track[] = [];
  for (const pageNumber of pagesToFetch) {
    try {
      const savedTracks = await spotifyClient.currentUser.tracks
        .savedTracks(pageSize, pageNumber * pageSize)
        .then((tracks) => tracks.items)
        .then((tracks) => tracks.map((t) => t.track));
      results = [...results, ...savedTracks];
    } catch (e) {
      console.error('Error fetching saved tracks page', pageNumber, e);
    }
  }

  return _(results)
    .chain()
    .uniqBy((t) => t.id)
    .map((track): SourcedTrack => ({ kind: 'track', track, source: 'saved track' }))
    .sampleSize(options.numberOfTracks)
    .value();
}

export async function fetchSpotifyTracks(options: {
  numberOfTracks: number;
}): Promise<SourcedTrack[]> {
  const requiredContributionPerSource = Math.ceil(options.numberOfTracks / 4);
  const allAvailableTracks = (
    await Promise.all([
      playlistTracks({ numberOfTracks: requiredContributionPerSource }),
      topTracks({ numberOfTracks: requiredContributionPerSource }),
      recentlyPlayedTracks({ numberOfTracks: requiredContributionPerSource }),
      savedTracks({ numberOfTracks: requiredContributionPerSource }),
      fetchListenBrainzRecommendations({ numberOfTracks: requiredContributionPerSource }),
    ])
  ).flat();

  return _(allAvailableTracks)
    .chain()
    .filter((t) => !!t.track)
    .uniqBy((t) => t.track.id)
    .sampleSize(options.numberOfTracks)
    .value();
}