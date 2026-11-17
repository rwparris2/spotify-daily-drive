import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';

// trackId → UTC dates (YYYY-MM-DD) the track was on the playlist, last 6 days only.
type TrackHistory = Record<string, string[]>;

const DAY_MS = 86_400_000;

function historyPath(): string {
  return process.env.TRACK_HISTORY_PATH ?? '.cache/track-history.json';
}

export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBefore(date: string, today: string): number {
  return (Date.parse(today) - Date.parse(date)) / DAY_MS;
}

// Today's entries are ignored so a same-day rerun neither blocks nor double-counts.
function pastWeek(dates: string[], today: string): string[] {
  return dates.filter((d) => {
    const n = daysBefore(d, today);
    return n >= 1 && n <= 6;
  });
}

export async function loadTrackHistory(): Promise<TrackHistory> {
  try {
    return JSON.parse(await readFile(historyPath(), 'utf8')) as TrackHistory;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw new Error(`Failed to read track history at ${historyPath()}: ${(e as Error).message}`, {
      cause: e,
    });
  }
}

// Blocks a track that was on yesterday's playlist, or on 2 of the past 6 days
// (today would make a 3rd inside a 7-day window).
export function isBlockedByHistory(history: TrackHistory, trackId: string, today: string): boolean {
  const past = pastWeek(history[trackId] ?? [], today);
  return past.some((d) => daysBefore(d, today) === 1) || past.length >= 2;
}

export async function recordTrackHistory(trackIds: string[], today: string): Promise<void> {
  const history = await loadTrackHistory();
  const next: TrackHistory = {};
  for (const [id, dates] of Object.entries(history)) {
    const kept = pastWeek(dates, today);
    if (kept.length > 0) next[id] = kept;
  }
  for (const id of trackIds) (next[id] ??= []).push(today);
  await mkdir(dirname(historyPath()), { recursive: true });
  await writeFile(historyPath(), JSON.stringify(next, null, 2), 'utf8');
}
