/**
 * LRC (synced lyrics) parsing.
 *
 * Extracted from LyricsPlayer so timestamp handling is unit-testable in isolation.
 * Accepts every form seen in the wild — `[mm:ss]`, `[m:ss.x]`, `[mm:ss.xx]`, `[mm:ss.xxx]` —
 * where the fractional part is optional and minutes are unbounded (long DJ mixes run past
 * 99 minutes, and this app splits such mixes into segments).
 */

export interface LyricsLine {
  time: number;
  text: string;
  /** Where this line stops: the next line's start, or a short tail for the final line. */
  endTime?: number;
}

const LRC_TIMESTAMP = /\[(\d+):(\d{2})(?:\.(\d{1,3}))?\](.*)/;
const SECONDS_PER_MINUTE = 60;
const CENTISECONDS_PER_SECOND = 100;
const TRAILING_LINE_SECONDS = 5;

/** Parse LRC text into time-ordered lines, each annotated with when it ends. */
export function parseSyncedLyrics(syncedText: string): LyricsLine[] {
  const lines: LyricsLine[] = [];

  for (const line of syncedText.split('\n')) {
    const match = line.match(LRC_TIMESTAMP);
    if (!match) continue;

    const text = match[4].trim();
    if (!text) continue;

    const minutes = parseInt(match[1]);
    const seconds = parseInt(match[2]);
    // Fractional part is optional and 1-3 digits, so it is padded then truncated to
    // centiseconds: `.5` and `.500` both mean 50cs.
    const centiseconds = match[3] ? parseInt(match[3].padEnd(2, '0').substring(0, 2)) : 0;

    lines.push({
      time: minutes * SECONDS_PER_MINUTE + seconds + centiseconds / CENTISECONDS_PER_SECOND,
      text,
    });
  }

  const sorted = lines.sort((a, b) => a.time - b.time);
  for (let i = 0; i < sorted.length; i++) {
    const isLast = i === sorted.length - 1;
    sorted[i].endTime = isLast ? sorted[i].time + TRAILING_LINE_SECONDS : sorted[i + 1].time;
  }
  return sorted;
}
