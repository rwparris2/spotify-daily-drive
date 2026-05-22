import type { Track } from '@spotify/web-api-ts-sdk';
import type { SourcedTrack } from './DailyDrivePlaylistItem.js';

export async function fetchLastFmDiscoveries(_options: {
  seedTracks: Track[];
  numberOfTracks: number;
}): Promise<SourcedTrack[]> {
  const apiKey = process.env.LASTFM_API_KEY;
  if (!apiKey) {
    console.warn('LASTFM_API_KEY not set; skipping Last.fm discoveries.');
    return [];
  }
  return [];
}
