// Markers the backend prefixes onto error_message (backend/task/tasks.py), each mapped
// to a localized, actionable hint shown instead of raw yt-dlp output. Matched anywhere in
// the message because retries prepend "Retry attempt N: " / "Manual retry: ".
const ERROR_HINT_TRANSLATION_KEYS: Record<string, string> = {
  '[blocked_url]': 'downloadStatus.errors.blockedUrl',
  '[cookies_refresh]': 'downloadStatus.errors.cookiesRefresh',
  '[cookies_file_access]': 'downloadStatus.errors.cookiesFileAccess',
};

export function describeDownloadError(errorMessage: string, translate: (key: string) => string): string {
  const marker = Object.keys(ERROR_HINT_TRANSLATION_KEYS).find((candidate) => errorMessage.includes(candidate));
  return marker ? translate(ERROR_HINT_TRANSLATION_KEYS[marker]) : errorMessage;
}
