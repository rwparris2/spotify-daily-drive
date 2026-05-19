import type { SimplifiedEpisode, Track } from '@spotify/web-api-ts-sdk';

export type PlaylistItem = { episode: SimplifiedEpisode } | { track: Track };
