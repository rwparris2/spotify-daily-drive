import { SimplifiedEpisode, Track } from '@spotify/web-api-ts-sdk';
import { SPOTIFY_PLAYLIST_ID } from './config.js';
import { assemblePlan, largestViableN, songsNeeded } from './DailyDrivePlan.js';
import type { PlanItem } from './DailyDrivePlan.js';
import { loadPodcastConfig } from './PodcastConfig.js';
import { replacePlaylist } from './SpotifyPlaylist.js';
import { fetchSpotifyPodcasts } from './SpotifyPodcasts.js';
import { fetchSpotifyTracks } from './SpotifyTracks.js';

const NUMBER_OF_PODCASTS = 8;

const dryRun = process.argv.includes('--dry-run');

// const podcasts: SimplifiedEpisode[] = await fetchSpotifyPodcasts({
//   numberOfPodcasts: NUMBER_OF_PODCASTS,
// });
const podcasts: (SimplifiedEpisode | undefined)[] = [undefined, undefined];
const tracks: Track[] = await fetchSpotifyTracks({ numberOfTracks: NUMBER_OF_PODCASTS * 5 });

const playlist: (SimplifiedEpisode | Track)[] = [];
for (let i = 0; i < podcasts.length; i++) {
  const p = podcasts[i];
  if (p) playlist.push(p);

  for (let j = 0; j < songsNeeded(i + 2); j++) {
    const t = tracks.shift();
    if (t) playlist.push(t);
  }
}

console.log(`Playlist assembled with ${playlist.length} items`);
playlist.forEach((it, i) => console.log(`${i + 1}. ${it.name} | ${it.id}`));

if (dryRun) {
  console.log('\nDRY RUN — no Spotify changes.');
  process.exit(0);
}

// await replacePlaylist(SPOTIFY_PLAYLIST_ID, plan);
// console.log(`\nPlaylist updated → https://open.spotify.com/playlist/${SPOTIFY_PLAYLIST_ID}`);
