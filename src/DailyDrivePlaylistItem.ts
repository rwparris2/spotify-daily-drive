import type { SimplifiedEpisode, Track } from '@spotify/web-api-ts-sdk';

export type DailyDrivePlaylistItem = { episode: SimplifiedEpisode } | { track: Track };
