const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

const twoDigits = (value: number) => String(value).padStart(2, '0');

/** A track's length as m:ss, or h:mm:ss once it reaches an hour. */
export function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(seconds / SECONDS_PER_HOUR);
  const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
  const remainder = seconds % SECONDS_PER_MINUTE;
  if (hours > 0) return `${hours}:${twoDigits(minutes)}:${twoDigits(remainder)}`;
  return `${minutes}:${twoDigits(remainder)}`;
}
