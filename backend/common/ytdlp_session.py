"""The one way this application opens yt-dlp.

yt-dlp rewrites its cookie file in place when it closes, so two downloads sharing the file can
leave it unreadable, and the slower one can put back a session YouTube has already rotated. Each
session therefore works on a private copy, and only the cookies it actually changed go back.

The generic extractor stays out: it fetches any page and follows redirects to wherever they lead,
which the public-address check on the first URL cannot see.
"""

import fcntl
import os
import shutil
import stat
import tempfile
from contextlib import contextmanager

import yt_dlp
from yt_dlp.cookies import YoutubeDLCookieJar

COOKIES_FILE = os.environ.get('YT_COOKIES_FILE', '/app/cookies.txt')
COOKIES_LOCK_FILE = os.path.join(tempfile.gettempdir(), 'soundwave-cookies.lock')
PRIVATE_COOKIES_PREFIX = 'soundwave-cookies-'
MINIMUM_COOKIE_FILE_BYTES = 100
ALLOWED_EXTRACTORS = ['default', '-generic']


def _shared_cookies_usable():
    try:
        details = os.stat(COOKIES_FILE)
    except OSError:
        return False
    return stat.S_ISREG(details.st_mode) and details.st_size > MINIMUM_COOKIE_FILE_BYTES


@contextmanager
def _cookie_file_lock():
    with open(COOKIES_LOCK_FILE, 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def _load_cookie_jar(path):
    jar = YoutubeDLCookieJar(path)
    jar.load()
    return jar


def _cookie_values(jar):
    return {(cookie.domain, cookie.path, cookie.name): cookie.value for cookie in jar}


def _publish_changed_cookies(private_path, values_at_start):
    session = _load_cookie_jar(private_path)
    changed = [
        cookie for cookie in session
        if values_at_start.get((cookie.domain, cookie.path, cookie.name)) != cookie.value
    ]
    if not changed:
        return
    with _cookie_file_lock():
        shared = _load_cookie_jar(COOKIES_FILE)
        for cookie in changed:
            shared.set_cookie(cookie)
        # ponytail: in place, not renamed, because cookies.txt is a single-file bind mount that
        # refuses rename; a process killed inside this write can still truncate the file.
        shared.save()


@contextmanager
def _private_cookie_options():
    descriptor, private_path = tempfile.mkstemp(prefix=PRIVATE_COOKIES_PREFIX)
    os.close(descriptor)
    try:
        # Checked under the lock: mid-rewrite the shared file looks too small to hold cookies.
        with _cookie_file_lock():
            has_cookies = _shared_cookies_usable()
            if has_cookies:
                shutil.copyfile(COOKIES_FILE, private_path)
        if not has_cookies:
            yield {}
            return
        values_at_start = _cookie_values(_load_cookie_jar(private_path))
        try:
            yield {'cookiefile': private_path}
        finally:
            _publish_changed_cookies(private_path, values_at_start)
    finally:
        os.unlink(private_path)


@contextmanager
def youtube_session(options):
    """A YoutubeDL client on these options, with the cookie and extractor rules applied."""
    with _private_cookie_options() as cookie_options:
        session_options = {**options, 'allowed_extractors': ALLOWED_EXTRACTORS, **cookie_options}
        with yt_dlp.YoutubeDL(session_options) as client:
            yield client
