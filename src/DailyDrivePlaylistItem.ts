import type { SimplifiedEpisode, Track } from '@spotify/web-api-ts-sdk';

export type SourcedTrack = { kind: 'track'; track: Track; source: string };
export type SourcedEpisode = { kind: 'episode'; episode: SimplifiedEpisode; source: string };

export type DailyDrivePlaylistItem = SourcedEpisode | SourcedTrack;
