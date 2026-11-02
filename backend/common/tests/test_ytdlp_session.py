"""The cookie and extractor rules every yt-dlp session gets. Synthetic cookies, loopback only."""
import http.server
import os
import stat
import tempfile
import threading
from unittest import mock

import yt_dlp
from django.test import SimpleTestCase
from yt_dlp.cookies import YoutubeDLCookieJar

from common import ytdlp_session
from common.ytdlp_session import youtube_session
from task.tasks import COOKIES_REFRESH_MARKER, is_permanently_unavailable, mark_cookie_errors

COOKIE_DOMAIN = '.example.test'
COOKIE_COUNT = 1500
PARALLEL_SESSIONS = 2
ROUNDS_PER_SESSION = 15
QUIET = {'quiet': True, 'no_warnings': True}
SESSION_START_WAIT_SECONDS = 0.3


def _cookie_line(name, value):
    return f'{COOKIE_DOMAIN}\tTRUE\t/\tFALSE\t2000000000\t{name}\t{value}\n'


def _set_cookie(client, name, value):
    template = next(iter(client.cookiejar))
    template.name, template.value = name, value
    client.cookiejar.set_cookie(template)


class CookieFileCase(SimpleTestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.path = os.path.join(folder.name, 'cookies.txt')
        self._write_cookies(COOKIE_COUNT)
        for name, value in (
            ('COOKIES_FILE', self.path),
            ('COOKIES_LOCK_FILE', os.path.join(folder.name, 'cookies.lock')),
        ):
            patcher = mock.patch.object(ytdlp_session, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def _write_cookies(self, count):
        with open(self.path, 'w') as cookie_file:
            cookie_file.write('# Netscape HTTP Cookie File\n')
            cookie_file.writelines(_cookie_line(f'SYNTH{i}', f'start{i}') for i in range(count))

    def _shared_values(self):
        jar = YoutubeDLCookieJar(self.path)
        jar.load()
        return {cookie.name: cookie.value for cookie in jar}


class ParallelSessionTests(CookieFileCase):
    def test_parallel_sessions_leave_the_shared_file_readable_and_complete(self):
        failures = []
        start_together = threading.Barrier(PARALLEL_SESSIONS)

        def rotate(worker):
            start_together.wait()
            try:
                for round_number in range(ROUNDS_PER_SESSION):
                    with youtube_session(QUIET) as client:
                        _set_cookie(client, f'ROTATED{worker}', f'round{round_number}')
            except Exception as error:  # the assertion below reports it on the test's own thread
                failures.append(error)

        threads = [threading.Thread(target=rotate, args=(worker,)) for worker in range(PARALLEL_SESSIONS)]
        [thread.start() for thread in threads]
        [thread.join() for thread in threads]

        self.assertEqual(failures, [])
        values = self._shared_values()
        self.assertEqual(len(values), COOKIE_COUNT + PARALLEL_SESSIONS)
        for worker in range(PARALLEL_SESSIONS):
            self.assertEqual(values[f'ROTATED{worker}'], f'round{ROUNDS_PER_SESSION - 1}')

    def test_a_session_starting_during_another_sessions_save_waits_and_keeps_its_cookies(self):
        finished = threading.Event()
        cookie_counts = []

        def start_session():
            with youtube_session(QUIET) as client:
                cookie_counts.append(len(client.cookiejar))
            finished.set()

        with ytdlp_session._cookie_file_lock():
            complete_file = open(self.path).read()
            open(self.path, 'w').close()
            session = threading.Thread(target=start_session)
            session.start()
            self.assertFalse(finished.wait(SESSION_START_WAIT_SECONDS))
            with open(self.path, 'w') as cookie_file:
                cookie_file.write(complete_file)
        session.join()

        self.assertEqual(cookie_counts, [COOKIE_COUNT])

    def test_a_slow_session_does_not_put_back_a_cookie_that_rotated_meanwhile(self):
        with youtube_session(QUIET) as slow:
            with youtube_session(QUIET) as fast:
                _set_cookie(fast, 'SYNTH1', 'rotated-by-fast')
            _set_cookie(slow, 'SYNTH2', 'rotated-by-slow')

        values = self._shared_values()
        self.assertEqual(values['SYNTH1'], 'rotated-by-fast')
        self.assertEqual(values['SYNTH2'], 'rotated-by-slow')

    def test_a_session_that_changed_nothing_does_not_rewrite_the_file(self):
        before = os.stat(self.path).st_mtime_ns

        with youtube_session(QUIET):
            pass

        self.assertEqual(os.stat(self.path).st_mtime_ns, before)

    def test_a_failed_session_still_keeps_what_youtube_rotated(self):
        with self.assertRaises(RuntimeError):
            with youtube_session(QUIET) as client:
                _set_cookie(client, 'SYNTH3', 'rotated-before-failure')
                raise RuntimeError('download failed')

        self.assertEqual(self._shared_values()['SYNTH3'], 'rotated-before-failure')


class PrivateCopyTests(CookieFileCase):
    def _session_options(self):
        with mock.patch.object(yt_dlp, 'YoutubeDL', wraps=yt_dlp.YoutubeDL) as client_class:
            with youtube_session(QUIET):
                private_path = client_class.call_args.args[0].get('cookiefile')
                private_exists = private_path and os.path.exists(private_path)
                mode = private_path and stat.S_IMODE(os.stat(private_path).st_mode)
        return private_path, private_exists, mode

    def test_the_copy_is_private_and_removed_afterwards(self):
        private_path, private_exists, mode = self._session_options()

        self.assertNotEqual(private_path, self.path)
        self.assertTrue(private_exists)
        self.assertEqual(mode, 0o600)
        self.assertFalse(os.path.exists(private_path))

    def test_no_usable_shared_file_means_no_cookies(self):
        for label, prepare in (
            ('placeholder', lambda: self._write_cookies(0)),
            ('missing', lambda: os.unlink(self.path)),
            ('docker made a directory', lambda: os.mkdir(self.path)),
        ):
            with self.subTest(label):
                prepare()
                self.assertIsNone(self._session_options()[0])

    def test_a_malformed_file_reports_the_cookie_refresh_hint(self):
        with open(self.path, 'w') as cookie_file:
            cookie_file.write('not a cookie file\n' * 20)

        with self.assertRaises(Exception) as caught:
            with youtube_session(QUIET):
                pass

        self.assertTrue(mark_cookie_errors(str(caught.exception)).startswith(COOKIES_REFRESH_MARKER))


class ExtractorConfinementTests(SimpleTestCase):
    """A public URL may redirect anywhere, so the generic extractor must never fetch it."""

    def setUp(self):
        self.requests = requests = []

        class Recorder(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                requests.append(self.path)
                self.send_response(302)
                self.send_header('Location', '/redirected')
                self.send_header('Content-Length', '0')
                self.end_headers()

            def log_message(self, *arguments):
                pass

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Recorder)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        self.url = f'http://127.0.0.1:{server.server_port}/start'

    def test_an_arbitrary_url_is_refused_before_any_request_and_not_retried(self):
        with self.assertRaises(yt_dlp.utils.DownloadError) as caught:
            with youtube_session({**QUIET, 'noplaylist': True}) as client:
                client.extract_info(self.url, download=False)

        self.assertEqual(self.requests, [])
        self.assertTrue(is_permanently_unavailable(str(caught.exception)))

    def test_youtube_links_still_have_their_extractor(self):
        with youtube_session(QUIET) as client:
            suitable = [
                extractor.IE_NAME for extractor in client._ies.values()
                if extractor.suitable('https://www.youtube.com/watch?v=aaaaaaaaaaa')
            ]

        self.assertIn('youtube', suitable)
