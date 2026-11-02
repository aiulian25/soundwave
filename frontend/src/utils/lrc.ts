/**
 * LRC (synced lyrics) parsing.
 *
 * Implements the contract written out in backend/audio/lrc.py, so upload, tag writing and the
 * player agree. Both are tested against backend/audio/tests/fixtures/lrc_contract.json.
 */

export interface LyricsLine {
  time: number;
  text: string;
}

const STAMP = String.raw`\[\d+:\d{2}(?:\.\d{1,3})?\]`;
const TIMED_LINE = new RegExp(String.raw`^\s*((?:${STAMP}\s*)+)(.*)$`);
const STAMP_PARTS = /\[(\d+):(\d{2})(?:\.(\d{1,3}))?\]/g;
const OFFSET_TAG = /^\s*\[offset:\s*([+-]?\d+)\s*\]\s*$/im;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1000;
const FRACTION_DIGITS = 3;

function stampMilliseconds(minutes: string, seconds: string, fraction?: string): number {
  const wholeSeconds = parseInt(minutes) * SECONDS_PER_MINUTE + parseInt(seconds);
  return wholeSeconds * MILLISECONDS_PER_SECOND + parseInt((fraction ?? '').padEnd(FRACTION_DIGITS, '0'));
}

/** Parse LRC text into time-ordered lines. */
export function parseSyncedLyrics(syncedText: string): LyricsLine[] {
  const offsetMs = parseInt(syncedText.match(OFFSET_TAG)?.[1] ?? '0');
  const lines: LyricsLine[] = [];

  for (const line of syncedText.split(/\r?\n/)) {
    const match = line.match(TIMED_LINE);
    if (!match) continue;

    const text = match[2].trim();
    if (!text) continue;

    for (const [, minutes, seconds, fraction] of match[1].matchAll(STAMP_PARTS)) {
      const timeMs = Math.max(stampMilliseconds(minutes, seconds, fraction) - offsetMs, 0);
      lines.push({ time: timeMs / MILLISECONDS_PER_SECOND, text });
    }
  }

  // Ordering matters: the player finds the active line by scanning backwards for the last
  // one that has started.
  return lines.sort((a, b) => a.time - b.time);
}

const pad = (value: number, length: number) => String(value).padStart(length, '0');

/** Events as canonical LRC: `[mm:ss.xxx]text`, one stamp per line and no offset tag. */
export function formatLrc(events: { timeMs: number; text: string }[]): string {
  return events
    .map(({ timeMs, text }) => {
      const wholeSeconds = Math.floor(timeMs / MILLISECONDS_PER_SECOND);
      const minutes = Math.floor(wholeSeconds / SECONDS_PER_MINUTE);
      return `[${pad(minutes, 2)}:${pad(wholeSeconds % SECONDS_PER_MINUTE, 2)}.${pad(timeMs % MILLISECONDS_PER_SECOND, 3)}]${text}`;
    })
    .join('\n');
}
