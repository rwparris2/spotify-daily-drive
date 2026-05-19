import { Page, PlaylistedTrack, SimplifiedPlaylist, Track } from '@spotify/web-api-ts-sdk';
import { spotifyClient } from './SpotifyClient.js';
import {
  getCachedPlaylistTracks,
  setCachedPlaylistTracks,
} from './SpotifyPlaylistTracksCache.js';
import _ from 'lodash';

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
      results = [...results, ...page.items.map((x) => x.track)];
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

async function playlistTracks() {
  const playlists = await fetchAllPlaylists();
  const playlistsToFetch = _.sampleSize(playlists, 5);
  let results: Track[] = [];
  for (const p of playlistsToFetch) {
    const cached = await getCachedPlaylistTracks(p.id, p.snapshot_id);
    if (cached) {
      console.log(`Cache hit for ${p.name} (${cached.length} tracks)`);
      results = [...results, ...cached];
      continue;
    }

    const { tracks, complete } = await fetchSongsFromPlayList(p.id);
    if (complete) {
      await setCachedPlaylistTracks(p.id, p.snapshot_id, tracks);
    }
    results = [...results, ...tracks];
  }
  return _(results)
    .chain()
    .uniqBy((t) => t.id)
    .sampleSize(20)
    .value();
}

async function topTracks() {
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
    .sampleSize(20)
    .value();
}

async function recentlyPlayedTracks() {
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
    .sampleSize(20)
    .value();
}

async function savedTracks() {
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
    .sampleSize(20)
    .value();
}

export async function fetchSpotifyTracks(target = 60): Promise<Track[]> {
  const allAvailableTracks = (
    await Promise.all([playlistTracks(), topTracks(), recentlyPlayedTracks(), savedTracks()])
  ).flat();
  return _(allAvailableTracks).chain().uniqBy((t) => t.id).sampleSize(target).value();
}
