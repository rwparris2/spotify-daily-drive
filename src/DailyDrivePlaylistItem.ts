import type { SimplifiedEpisode, Track } from '@spotify/web-api-ts-sdk';

export type SourcedTrack = { track: Track; source: string };
export type SourcedEpisode = { episode: SimplifiedEpisode; source: string };

export type DailyDrivePlaylistItem = SourcedEpisode | SourcedTrack;