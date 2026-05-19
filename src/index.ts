import { Page, PlaylistedTrack, SimplifiedPlaylist, Track } from '@spotify/web-api-ts-sdk';
import { spotifyClient } from './SpotifyClient.js';
import {
  getAllCachedTracks,
  getCachedTracks,
  setCachedTracks,
} from './playlistItemsCache.js';

async function fetchAllPlaylists<T>(): Promise<SimplifiedPlaylist[]> {
  const pageSize = 50;
  let currentPage = 0;
  let hasNextPage = true;

  let results: SimplifiedPlaylist[] = [];
  while (hasNextPage) {
    const page = await spotifyClient.currentUser.playlists.playlists(
      pageSize,
      currentPage * pageSize,
    );
    results = [...results, ...page.items];
    hasNextPage = !!page.next;
    currentPage += 1;
  }

  return results;
}

async function fetchSongsFromPlayList(playlistId: string): Promise<Track[]> {
  const pageSize = 50;
  let currentPage = 0;
  let hasNextPage = true;

  let results: Track[] = [];
  while (hasNextPage) {
    const page = await spotifyClient.makeRequest<Page<PlaylistedTrack<Track>>>(
      'GET',
      `playlists/${playlistId}/items?limit=${pageSize}&offset=${currentPage * pageSize}`,
    );
    results = [...results, ...page.items.map((x) => x.track)];
    hasNextPage = !!page.next;
    currentPage += 1;
  }

  return results;
}

async function fetchAllTracksFromAllPlaylists(): Promise<Track[]> {
  let allPlaylists: SimplifiedPlaylist[];
  try {
    allPlaylists = await fetchAllPlaylists();
  } catch (e) {
    console.warn('Failed to list playlists — falling back to whatever is cached.', e);
    return getAllCachedTracks();
  }
  console.log(`Found ${allPlaylists.length} playlists. Fetching tracks...`);

  let results: Track[] = [];
  for (const p of allPlaylists) {
    const cached = await getCachedTracks(p.id, p.snapshot_id);
    if (cached) {
      console.log(`Cache hit for ${p.name} (${cached.length} tracks)`);
      results = [...results, ...cached];
      continue;
    }

    try {
      const playlistTracks = await fetchSongsFromPlayList(p.id);
      await setCachedTracks(p.id, p.snapshot_id, playlistTracks);
      results = [...results, ...playlistTracks];
    } catch (e) {
      console.warn(`Fetch failed for ${p.name}; skipping.`, e);
    }
  }
  return results;
}

const topItemsShortTerm = await spotifyClient.currentUser
  .topItems('tracks', 'short_term', 10)
  .then((page) => page.items);
const topItemsMediumTerm = await spotifyClient.currentUser
  .topItems('tracks', 'medium_term', 10)
  .then((page) => page.items);
const topItemsLongTerm = await spotifyClient.currentUser
  .topItems('tracks', 'long_term', 10)
  .then((page) => page.items);
const recentlyPlayedTracks = await spotifyClient.player
  .getRecentlyPlayedTracks(50)
  .then((page) => page.items)
  .then((items) => items.map((i) => i.track));
const savedTracks = await spotifyClient.currentUser.tracks
  .savedTracks(50)
  .then((tracks) => tracks.items)
  .then((tracks) => tracks.map((t) => t.track));
const playlistTracks = await fetchAllTracksFromAllPlaylists();

const allAvailableTracks = [
  ...topItemsShortTerm,
  ...topItemsMediumTerm,
  ...topItemsLongTerm,
  ...recentlyPlayedTracks,
  ...savedTracks,
  ...playlistTracks,
];

console.log(`Found ${allAvailableTracks.length} tracks in total.`);
