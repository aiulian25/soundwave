import { formatLrc, parseSyncedLyrics } from './lrc';

export interface TimedLine {
  timeMs: number;
  text: string;
}

export type TimingIssue = 'outOfOrder' | 'pastEnd';

const MILLISECONDS_PER_SECOND = 1000;
// Must match DURATION_TOLERANCE_MS in backend/audio/lyrics_timing.py.
const DURATION_TOLERANCE_MS = 1000;

export const timedLinesFromLrc = (lrc: string): TimedLine[] =>
  parseSyncedLyrics(lrc).map(({ time, text }) => ({
    timeMs: Math.round(time * MILLISECONDS_PER_SECOND),
    text,
  }));

export const lrcFromTimedLines = (lines: TimedLine[]): string => formatLrc(lines);

export const shiftLines = (lines: TimedLine[], deltaMs: number): TimedLine[] =>
  lines.map((line) => ({ ...line, timeMs: Math.max(line.timeMs + deltaMs, 0) }));

export const retimeLine = (lines: TimedLine[], index: number, timeMs: number): TimedLine[] =>
  lines.map((line, lineIndex) => (lineIndex === index ? { ...line, timeMs: Math.max(Math.round(timeMs), 0) } : line));

/** Which lines cannot be saved as they stand, by line index. */
export function timingIssues(lines: TimedLine[], durationSeconds?: number): Map<number, TimingIssue> {
  const issues = new Map<number, TimingIssue>();
  const latestAllowedMs = durationSeconds
    ? durationSeconds * MILLISECONDS_PER_SECOND + DURATION_TOLERANCE_MS
    : Infinity;

  lines.forEach((line, index) => {
    if (line.timeMs > latestAllowedMs) issues.set(index, 'pastEnd');
    if (index > 0 && line.timeMs < lines[index - 1].timeMs) issues.set(index, 'outOfOrder');
  });
  return issues;
}

/** The line playing at this position: the last one to have started, or -1 before the first. */
export function activeLineIndex(lines: TimedLine[], positionMs: number): number {
  return lines.reduce((active, line, index) => (line.timeMs <= positionMs ? index : active), -1);
}

const sortedWords = (lines: TimedLine[]) => lines.map((line) => line.text).sort();

/** Whether timing from one set of lines can apply to another: the same words, in any order. */
export function sameWords(first: TimedLine[], second: TimedLine[]): boolean {
  const firstWords = sortedWords(first);
  const secondWords = sortedWords(second);
  return firstWords.length === secondWords.length && firstWords.every((text, index) => text === secondWords[index]);
}

export function formatPosition(timeMs: number): string {
  const totalSeconds = Math.floor(timeMs / MILLISECONDS_PER_SECOND);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  const fraction = String(timeMs % MILLISECONDS_PER_SECOND).padStart(3, '0');
  return `${Math.floor(totalSeconds / 60)}:${seconds}.${fraction}`;
}
