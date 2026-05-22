import { fetchSpotifyTracks } from './SpotifyTracks.js';
import { fetchSpotifyPodcasts } from './SpotifyPodcasts.js';
import { replacePlaylist } from './SpotifyPlaylist.js';
import { SPOTIFY_PLAYLIST_ID } from './config.js';
import { DailyDrivePlaylistItem, SourcedEpisode, SourcedTrack } from './DailyDrivePlaylistItem.js';

const NUMBER_OF_PODCASTS = 10;
// Gaps between podcasts grow 2, 3, …, n, so n(n+1)/2 + 1 fills them with 1 to spare.
// ×1.2 gives a ~20% long tail after the final podcast.
const NUMBER_OF_TRACKS = Math.ceil(((NUMBER_OF_PODCASTS * (NUMBER_OF_PODCASTS + 1)) / 2 + 1) * 1.2);

const dryRun = process.argv.includes('--dry-run');

let podcasts: (SourcedEpisode | undefined)[] = await fetchSpotifyPodcasts({
  numberOfPodcasts: NUMBER_OF_PODCASTS,
});
const tracks: SourcedTrack[] = await fetchSpotifyTracks({
  numberOfTracks: NUMBER_OF_TRACKS,
});

// HACK
// if we somehow did not get any podcasts, we won't get any tracks either
// that's not what we want!
// we can add an undefined podcast to the end of the list to make sure we get tracks, and it will filter itself out
if (podcasts.length === 0) {
  podcasts.push(undefined);
}

const playlist: DailyDrivePlaylistItem[] = [];
for (let i = 0; i < podcasts.length; i++) {
  const p = podcasts[i];
  if (p) playlist.push(p);

  const numSongs = i === podcasts.length - 1 ? tracks.length : i + 2;
  for (let j = 0; j < numSongs; j++) {
    const t = tracks.shift();
    if (t) playlist.push(t);
  }
}

console.log(`Playlist assembled with ${playlist.length} items`);
playlist.forEach((item, i) => {
  const n = String(i + 1).padStart(2, ' ');
  switch (item.kind) {
    case 'episode':
      console.log(
        `${n}. 🎙  ${item.episode.name}  [${item.episode.release_date}]  (${item.source})`,
      );
      break;
    case 'track': {
      const artists = item.track.artists.map((a) => a.name).join(', ');
      console.log(`${n}. 🎵  ${artists} — ${item.track.name}  (${item.source})`);
      break;
    }
  }
});

if (dryRun) {
  console.log('\nDRY RUN — no Spotify changes.');
  process.exit(0);
}

await replacePlaylist(SPOTIFY_PLAYLIST_ID, playlist);
console.log(`\nPlaylist updated → https://open.spotify.com/playlist/${SPOTIFY_PLAYLIST_ID}`);
