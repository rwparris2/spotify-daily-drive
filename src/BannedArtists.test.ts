import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Track } from '@spotify/web-api-ts-sdk';
import type { SourcedTrack } from './DailyDrivePlaylistItem.js';
import {
  createBannedArtists,
  filterBannedTracks,
  isTrackBanned,
  loadBannedArtists,
} from './BannedArtists.js';

function makeTrack(id: string, artists: Array<{ name: string; id?: string }>): Track {
  return {
    id,
    name: `Track ${id}`,
    uri: `spotify:track:${id}`,
    type: 'track',
    artists: artists.map((a, i) => ({
      name: a.name,
      id: a.id ?? `${id}_artist_${i}`,
      uri: '',
      external_urls: { spotify: '' },
      href: '',
      type: 'artist',
    })),
    album: {} as Track['album'],
    duration_ms: 200_000,
  } as Track;
}

function sourced(track: Track): SourcedTrack {
  return { kind: 'track', track, source: 'test' };
}

describe('isTrackBanned', () => {
  it('matches an artist name case-insensitively', () => {
    const banned = createBannedArtists({ names: ['Musiscape'] });
    expect(isTrackBanned(makeTrack('t1', [{ name: 'MUSISCAPE' }]), banned)).toBe(true);
  });

  it('ignores surrounding whitespace when matching names', () => {
    const banned = createBannedArtists({ names: ['  HUNTR/X  '] });
    expect(isTrackBanned(makeTrack('t2', [{ name: 'huntr/x' }]), banned)).toBe(true);
  });

  it('bans a track if ANY of its artists is banned', () => {
    const banned = createBannedArtists({ names: ['Musiscape'] });
    const track = makeTrack('t3', [{ name: 'Legit Collaborator' }, { name: 'Musiscape' }]);
    expect(isTrackBanned(track, banned)).toBe(true);
  });

  it('matches by Spotify artist id even when the name differs', () => {
    const banned = createBannedArtists({ ids: ['abc123'] });
    const track = makeTrack('t4', [{ name: 'Renamed Artist', id: 'abc123' }]);
    expect(isTrackBanned(track, banned)).toBe(true);
  });

  it('does not ban a track whose artists are all allowed', () => {
    const banned = createBannedArtists({ names: ['Musiscape'], ids: ['abc123'] });
    expect(isTrackBanned(makeTrack('t5', [{ name: 'Good Artist', id: 'ok' }]), banned)).toBe(false);
  });

  it('bans nothing when the ban list is empty', () => {
    const banned = createBannedArtists({});
    expect(isTrackBanned(makeTrack('t6', [{ name: 'Anyone' }]), banned)).toBe(false);
  });
});

describe('filterBannedTracks', () => {
  it('partitions tracks into kept and removed', () => {
    const banned = createBannedArtists({ names: ['Musiscape'] });
    const good = sourced(makeTrack('good', [{ name: 'Good Artist' }]));
    const bad = sourced(makeTrack('bad', [{ name: 'Musiscape' }]));

    const { kept, removed } = filterBannedTracks([good, bad], banned);

    expect(kept).toEqual([good]);
    expect(removed).toEqual([bad]);
  });
});

describe('loadBannedArtists', () => {
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  function writeToml(contents: string): string {
    dir = mkdtempSync(join(tmpdir(), 'banned-artists-test-'));
    const path = join(dir, 'banned-artists.toml');
    writeFileSync(path, contents, 'utf8');
    return path;
  }

  it('reads names and ids from a TOML file', async () => {
    const path = writeToml('names = ["Musiscape", "HUNTR/X"]\nids = ["spotify-id-1"]\n');

    const banned = await loadBannedArtists(path);

    expect(isTrackBanned(makeTrack('a', [{ name: 'musiscape' }]), banned)).toBe(true);
    expect(isTrackBanned(makeTrack('b', [{ name: 'whoever', id: 'spotify-id-1' }]), banned)).toBe(
      true,
    );
    expect(isTrackBanned(makeTrack('c', [{ name: 'Allowed' }]), banned)).toBe(false);
  });

  it('returns an empty ban list when the file is missing (no throw)', async () => {
    const banned = await loadBannedArtists(join(tmpdir(), 'does-not-exist-banned.toml'));
    expect(isTrackBanned(makeTrack('a', [{ name: 'Anyone' }]), banned)).toBe(false);
  });

  it('returns an empty ban list when the TOML is malformed (no throw)', async () => {
    const path = writeToml('names = [unterminated');
    const banned = await loadBannedArtists(path);
    expect(isTrackBanned(makeTrack('a', [{ name: 'Anyone' }]), banned)).toBe(false);
  });
});
