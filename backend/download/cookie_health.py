"""Whether YouTube still accepts the server's cookies.txt, judged from what downloads did last.

Nothing is asked of YouTube for this: an expired sign-in already shows up as marked failures in
the download queue, and the next download that goes through shows it is fine again.
"""

from django.db.models import F, Max, Q

from download.models import DownloadQueue

# Prefixed onto a queue row's error_message by the worker (task.tasks.mark_cookie_errors), so
# the interface can show what to do about cookies.txt instead of raw yt-dlp output.
COOKIES_REFRESH_MARKER = '[cookies_refresh]'
COOKIES_FILE_ACCESS_MARKER = '[cookies_file_access]'

COOKIES_WORKING = 'working'
COOKIES_NEED_REFRESH = 'needs_new_cookies'
COOKIES_FILE_NOT_ACCESSIBLE = 'file_not_accessible'
COOKIES_UNKNOWN = 'unknown'


def _latest_cookie_failure():
    """The newest failure that a new or readable cookies.txt would fix. Dismissed ones do not count."""
    about_cookies = Q(error_message__contains=COOKIES_REFRESH_MARKER) | Q(error_message__contains=COOKIES_FILE_ACCESS_MARKER)
    return (
        DownloadQueue.objects.filter(about_cookies, status='failed')
        .order_by(F('started_date').desc(nulls_last=True))
        .first()
    )


def cookie_health():
    """One of the COOKIES_* states. cookies.txt is the server's, so every account's downloads count."""
    failure = _latest_cookie_failure()
    last_success = DownloadQueue.objects.filter(status='completed').aggregate(latest=Max('completed_date'))['latest']
    if failure is None:
        return COOKIES_WORKING if last_success else COOKIES_UNKNOWN

    # ponytail: a failed row has no failure time, only when it started; a download that began
    # before the cookies expired and finished after would read as "working" until the next
    # failure. Add a failed_date column if that ever misleads.
    succeeded_since = bool(last_success and failure.started_date and last_success > failure.started_date)
    if succeeded_since:
        return COOKIES_WORKING
    if COOKIES_FILE_ACCESS_MARKER in failure.error_message:
        return COOKIES_FILE_NOT_ACCESSIBLE
    return COOKIES_NEED_REFRESH
