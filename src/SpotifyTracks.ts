import { Page, PlaylistedTrack, SimplifiedPlaylist, Track } from '@spotify/web-api-ts-sdk';
import { spotifyClient } from './SpotifyClient.js';
import _ from 'lodash';
import { SPOTIFY_PLAYLIST_ID } from './config.js';

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

  // remove the target playlist from the list of playlists to pull songs from, to avoid duplicates and stale data
  results = results.filter((p) => p.id != SPOTIFY_PLAYLIST_ID);

  return results;
}

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
      const page = await spotifyClient.makeRequest<Page<PlaylistedTrack<Track>>>(
        'GET',
        `playlists/${playlistId}/items?limit=${pageSize}&offset=${currentPage * pageSize}`,
      );
      const pageTracks = page.items.map((x) => x.track).filter((t): t is Track => t != null);
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

async function playlistTracks(options: { numberOfTracks: number }): Promise<Track[]> {
  const playlists = await fetchAllPlaylists();
  const playlistsToFetch = _.sampleSize(
    playlists,
    Math.min(3, Math.ceil(options.numberOfTracks / 3)),
  );
  let results: Track[] = [];
  for (const p of playlistsToFetch) {
    const { tracks } = await fetchSongsFromPlayList(p.id);
    results = [...results, ...tracks];
  }
  return _(results)
    .chain()
    .uniqBy((t) => t.id)
    .sampleSize(options.numberOfTracks)
    .value();
}

async function topTracks(options: { numberOfTracks: number }): Promise<Track[]> {
  let topItemsShortTerm: Track[] = [];
  try {
    topItemsShortTerm = await spotifyClient.currentUser
      .topItems('tracks', 'short_term', 50)
      .then((page) => page.items);
  } catch (e) {
    console.error('Error fetching topTracks short term', e);
  }

  let topItemsMediumTerm: Track[] = [];
  try {
    topItemsMediumTerm = await spotifyClient.currentUser
      .topItems('tracks', 'medium_term', 50)
      .then((page) => page.items);
  } catch (e) {
    console.error('Error fetching topTracks medium term', e);
  }

  let topItemsLongTerm: Track[] = [];
  try {
    topItemsLongTerm = await spotifyClient.currentUser
      .topItems('tracks', 'long_term', 50)
      .then((page) => page.items);
  } catch (e) {
    console.error('Error fetching topTracks long term', e);
  }

  const allTopItems = [...topItemsShortTerm, ...topItemsMediumTerm, ...topItemsLongTerm];
  return _(allTopItems)
    .chain()
    .uniqBy((t) => t.id)
    .sampleSize(options.numberOfTracks)
    .value();
}

async function recentlyPlayedTracks(options: { numberOfTracks: number }) {
  let recentlyPlayedTracks: Track[] = [];
  try {
    recentlyPlayedTracks = await spotifyClient.player
      .getRecentlyPlayedTracks(50)
      .then((page) => page.items)
      .then((items) => items.map((i) => i.track));
  } catch (e) {
    console.error('Error fetching recently played tracks', e);
  }

  return _(recentlyPlayedTracks)
    .chain()
    .uniqBy((t) => t.id)
    .sampleSize(options.numberOfTracks)
    .value();
}

async function savedTracks(options: { numberOfTracks: number }): Promise<Track[]> {
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
    .sampleSize(options.numberOfTracks)
    .value();
}

export async function fetchSpotifyTracks(options: { numberOfTracks: number }): Promise<Track[]> {
  const requiredContributionPerSource = Math.ceil(options.numberOfTracks / 3);
  const allAvailableTracks = (
    await Promise.all([
      playlistTracks({ numberOfTracks: requiredContributionPerSource }),
      topTracks({ numberOfTracks: requiredContributionPerSource }),
      recentlyPlayedTracks({ numberOfTracks: requiredContributionPerSource }),
      savedTracks({ numberOfTracks: requiredContributionPerSource }),
    ])
  ).flat();
  return _(allAvailableTracks)
    .chain()
    .filter((t) => !!t)
    .uniqBy((t) => t.id)
    .shuffle()
    .sampleSize(options.numberOfTracks)
    .value();
}
