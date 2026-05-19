import { readFile } from 'fs/promises';
import { parse } from 'smol-toml';
import { PODCASTS_CONFIG_PATH } from './config.js';

export type PodcastConfig = {
  shows: {
    name: string;
    spotify_show_id: string;
    itunes_categories?: string[];
    pin_slot?: number;
    latest_only?: boolean;
  }[];
};

export async function loadPodcastConfig(): Promise<PodcastConfig> {
  const tomlText = await readFile(PODCASTS_CONFIG_PATH, 'utf8');
  return parse(tomlText) as PodcastConfig;
}
