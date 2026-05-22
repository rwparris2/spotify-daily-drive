import { readFile } from 'fs/promises';
import { parse } from 'smol-toml';
import { PODCASTS_CONFIG_PATH } from './config.js';

export type PodcastMode = 'default' | 'latest_only' | 'sequential';

export type PodcastConfig = {
  shows: {
    name: string;
    spotify_show_id: string;
    pin_slot?: number;
    mode?: PodcastMode;
  }[];
};

export async function loadPodcastConfig(): Promise<PodcastConfig> {
  const tomlText = await readFile(PODCASTS_CONFIG_PATH, 'utf8');
  return parse(tomlText) as PodcastConfig;
}
