import { describe, expect, it } from 'vitest';
import { isBlockedByHistory, loadTrackHistory, recordTrackHistory } from './TrackHistory.js';

const today = '2026-11-17';

describe('isBlockedByHistory', () => {
  it.each([
    [[], false],
    [['2026-11-16'], true], // yesterday
    [['2026-11-15'], false], // once, 2 days ago
    [['2026-11-15', '2026-11-12'], true], // twice this week
    [['2026-11-15', '2026-11-10'], false], // second one is 7 days ago, outside window
    [['2026-11-17'], false], // same-day rerun
  ])('%j → %s', (dates, expected) => {
    expect(isBlockedByHistory({ a: dates }, 'a', today)).toBe(expected);
  });
});

describe('recordTrackHistory', () => {
  it('adds today, prunes old dates, and replaces earlier same-day entries', async () => {
    await recordTrackHistory(['a', 'b'], '2026-11-10');
    await recordTrackHistory(['a', 'c'], '2026-11-15');
    await recordTrackHistory(['x'], today);
    await recordTrackHistory(['a'], today);
    expect(await loadTrackHistory()).toEqual({
      a: ['2026-11-15', today],
      c: ['2026-11-15'],
    });
  });
});
