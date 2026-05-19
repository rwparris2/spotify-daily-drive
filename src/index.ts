import { SPOTIFY_PLAYLIST_ID } from './config.js';
import { assemblePlan, songsNeeded } from './DailyDrivePlan.js';
import type { PlanItem } from './DailyDrivePlan.js';
import { loadPodcastConfig } from './PodcastConfig.js';
import { replacePlaylist } from './SpotifyPlaylist.js';
import { selectPodcastSlots } from './SpotifyPodcasts.js';
import { fetchSpotifyTracks } from './SpotifyTracks.js';

const NUMBER_OF_PODCASTS = 8;

const dryRun = process.argv.includes('--dry-run');

const podcastConfig = await loadPodcastConfig();

const [podcastResult, tracks] = await Promise.all([
  selectPodcastSlots(podcastConfig, { numberOfPodcasts: NUMBER_OF_PODCASTS }),
  fetchSpotifyTracks(songsNeeded(NUMBER_OF_PODCASTS) + 16),
]);

const plan = assemblePlan(podcastResult.episodes, tracks, {
  numberOfPodcasts: NUMBER_OF_PODCASTS,
  dryRun,
});

printPlan(plan.items, podcastResult.skipped);

if (dryRun) {
  console.log('\nDRY RUN — no Spotify changes.');
  process.exit(0);
}

await replacePlaylist(SPOTIFY_PLAYLIST_ID, plan);
console.log(`\nPlaylist updated → https://open.spotify.com/playlist/${SPOTIFY_PLAYLIST_ID}`);

function printPlan(
  items: PlanItem[],
  skipped: { slot?: number; show_name?: string; reason: string }[],
): void {
  console.log('\n=== Daily Drive plan ===\n');
  items.forEach((item, idx) => {
    const n = String(idx + 1).padStart(2, ' ');
    if (item.kind === 'podcast') {
      const mins = Math.round(item.episode.duration_ms / 60_000);
      console.log(
        `${n}. [pod slot ${item.slot}] ${item.episode.show_name} — ${item.episode.title} (${mins}m)`,
      );
    } else {
      const artist = item.track.artists?.[0]?.name ?? 'Unknown';
      console.log(`${n}. [song]       ${artist} — ${item.track.name}`);
    }
  });

  if (skipped.length > 0) {
    console.log('\nSkipped:');
    for (const s of skipped) {
      const slot = s.slot !== undefined ? `slot ${s.slot}` : 'pool';
      const show = s.show_name ? ` (${s.show_name})` : '';
      console.log(`  - ${slot}${show}: ${s.reason}`);
    }
  }
}
