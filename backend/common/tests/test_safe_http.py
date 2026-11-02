"""SW-025: outbound fetches validate every hop and stop at their byte and time limits.

Mock transport for redirect policy; a real loopback server for what only a socket proves
(the connected peer check, read limits). No external or internal network is touched.

Run: python manage.py test common.tests.test_safe_http --settings=config.settings_test
"""
import gzip
import socket
import ssl
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

import requests
import yt_dlp  # noqa: F401 - patches requests' proxy selection in every real process, so here too
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID
from django.test import SimpleTestCase
from requests.adapters import BaseAdapter
from requests.structures import CaseInsensitiveDict

from common.safe_http import (
    MAX_REDIRECTS,
    REFUSED_DEADLINE,
    REFUSED_INTERNAL_ADDRESS,
    REFUSED_TOO_LARGE,
    REFUSED_TOO_MANY_REDIRECTS,
    REFUSED_UPSTREAM_STATUS,
    FetchRefused,
    fetch_public_url,
)

PUBLIC_ADDRESS = '8.8.8.8'
PRIVATE_ADDRESS = '10.0.0.5'
METADATA_ADDRESS = '169.254.169.254'
START_URL = 'https://art.example.test/cover.jpg'
ONE_MEGABYTE = 1024 * 1024
ADDRESS_BY_HOST = {
    'art.example.test': PUBLIC_ADDRESS,
    'cdn.example.test': PUBLIC_ADDRESS,
    'rebind.example.test': PRIVATE_ADDRESS,
}


class FakeBody:
    def __init__(self, content):
        self.remaining = content
        self.read_sizes = []

    def read1(self, amount, decode_content=None):
        self.read_sizes.append(amount)
        chunk, self.remaining = self.remaining[:amount], self.remaining[amount:]
        return chunk

    def close(self):
        pass

    def release_conn(self):
        pass


class FakeTransport(BaseAdapter):
    """Serves canned responses by URL and records what was actually requested."""

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False

    def __init__(self, routes):
        super().__init__()
        self.routes = routes
        self.requested = []

    def send(self, request, **kwargs):
        self.requested.append(request.url)
        status_code, headers, content = self.routes[request.url]
        response = requests.Response()
        response.status_code = status_code
        response.headers = CaseInsensitiveDict(headers)
        response.raw = FakeBody(content)
        response.url = request.url
        response.request = request
        return response

    def close(self):
        pass


def redirect_to(location, status_code=302):
    return (status_code, {'location': location}, b'')


def image_response(content=b'image-bytes'):
    return (200, {'content-type': 'image/jpeg'}, content)


def fake_getaddrinfo(host, port, **kwargs):
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, '', (ADDRESS_BY_HOST[host], port))]


class fake_network:
    """Context manager: no real DNS or sockets, just this table of routes."""

    def __init__(self, routes):
        self.transport = FakeTransport(routes)
        self.patches = [
            mock.patch('common.safe_http._PublicOnlyAdapter', return_value=self.transport),
            mock.patch('common.url_security.socket.getaddrinfo', fake_getaddrinfo),
        ]

    def __enter__(self):
        for active_patch in self.patches:
            active_patch.start()
        return self.transport

    def __exit__(self, *exc_info):
        for active_patch in self.patches:
            active_patch.stop()
        return False


class RedirectPolicyTests(SimpleTestCase):
    def fetch(self, url=START_URL):
        return fetch_public_url(url, ONE_MEGABYTE, 5)

    def assert_refused(self, code, routes, url=START_URL):
        with fake_network(routes) as transport, self.assertRaises(FetchRefused) as refused:
            self.fetch(url)
        self.assertEqual(refused.exception.code, code)
        return transport

    def test_direct_fetch_returns_body_and_type(self):
        with fake_network({START_URL: image_response()}):
            fetched = self.fetch()
        self.assertEqual((fetched.content, fetched.content_type), (b'image-bytes', 'image/jpeg'))

    def test_valid_public_redirects_are_followed(self):
        final = 'https://cdn.example.test/final.jpg'
        for status_code in (301, 302, 303, 307, 308):
            with self.subTest(status_code):
                routes = {START_URL: redirect_to(final, status_code), final: image_response()}
                with fake_network(routes) as transport:
                    self.assertEqual(self.fetch().content, b'image-bytes')
                self.assertEqual(transport.requested, [START_URL, final])

    def test_relative_redirect_is_resolved_and_validated(self):
        routes = {START_URL: redirect_to('/moved.jpg'), 'https://art.example.test/moved.jpg': image_response()}
        with fake_network(routes):
            self.assertEqual(self.fetch().content, b'image-bytes')

    def test_redirect_to_internal_targets_stops_before_requesting_them(self):
        targets = {
            'private literal': f'http://{PRIVATE_ADDRESS}/admin',
            'metadata service': f'http://{METADATA_ADDRESS}/latest/meta-data/',
            'loopback': 'http://127.0.0.1:9200/_cat/indices',
            'ipv4-mapped ipv6': 'http://[::ffff:127.0.0.1]/',
            'name resolving private': 'http://rebind.example.test/',
        }
        for label, target in targets.items():
            with self.subTest(label):
                transport = self.assert_refused(REFUSED_INTERNAL_ADDRESS, {START_URL: redirect_to(target)})
                self.assertEqual(transport.requested, [START_URL])

    def test_redirect_to_other_schemes_is_refused(self):
        for target in ('file:///etc/passwd', 'gopher://art.example.test/', 'ftp://art.example.test/a'):
            with self.subTest(target):
                transport = self.assert_refused('bad_scheme', {START_URL: redirect_to(target)})
                self.assertEqual(transport.requested, [START_URL])

    def test_initial_internal_url_is_refused_without_any_request(self):
        transport = self.assert_refused(REFUSED_INTERNAL_ADDRESS, {}, url=f'http://{PRIVATE_ADDRESS}/')
        self.assertEqual(transport.requested, [])

    def test_redirect_loop_stops(self):
        transport = self.assert_refused(REFUSED_TOO_MANY_REDIRECTS, {START_URL: redirect_to(START_URL)})
        self.assertEqual(len(transport.requested), MAX_REDIRECTS + 1)

    def test_longest_allowed_chain_succeeds(self):
        urls = [f'https://art.example.test/{hop}' for hop in range(MAX_REDIRECTS + 1)]
        routes = {current: redirect_to(following) for current, following in zip(urls, urls[1:])}
        routes[urls[-1]] = image_response()
        with fake_network(routes):
            self.assertEqual(self.fetch(urls[0]).content, b'image-bytes')

    def test_error_status_is_refused(self):
        self.assert_refused(REFUSED_UPSTREAM_STATUS, {START_URL: (404, {}, b'not found')})

    def test_body_stops_at_the_limit(self):
        with fake_network({START_URL: image_response(b'x' * 100)}), self.assertRaises(FetchRefused) as refused:
            fetch_public_url(START_URL, 99, 5)
        self.assertEqual(refused.exception.code, REFUSED_TOO_LARGE)

    def test_body_exactly_at_the_limit_is_accepted(self):
        with fake_network({START_URL: image_response(b'x' * 100)}):
            self.assertEqual(len(fetch_public_url(START_URL, 100, 5).content), 100)


class _LoopbackHandler(BaseHTTPRequestHandler):
    hits = 0
    gzip_bomb = gzip.compress(bytes(4 * ONE_MEGABYTE))

    def log_message(self, *args):
        pass

    def do_GET(self):
        type(self).hits += 1
        routes = {
            '/small': self._small,
            '/huge': self._huge_ok,
            '/bomb': self._bomb,
            '/drip': self._drip,
            '/redirect-with-endless-body': self._redirect_with_endless_body,
        }
        routes[self.path]()

    def _redirect_with_endless_body(self):
        self.send_response(302)
        self.send_header('Location', '/small')
        self._drip_body()

    def _small(self):
        self.send_response(200)
        self.send_header('Content-Type', 'image/png')
        self.send_header('Content-Length', '5')
        self.end_headers()
        self.wfile.write(b'hello')

    def _huge_ok(self):
        self.send_response(200)
        self._huge()

    def _huge(self):
        self.end_headers()
        try:
            for _ in range(64):
                self.wfile.write(bytes(ONE_MEGABYTE))
        except OSError:
            pass

    def _bomb(self):
        self.send_response(200)
        self.send_header('Content-Encoding', 'gzip')
        self.send_header('Content-Length', str(len(self.gzip_bomb)))
        self.end_headers()
        self.wfile.write(self.gzip_bomb)

    def _drip(self):
        self.send_response(200)
        self._drip_body()

    def _drip_body(self):
        self.end_headers()
        try:
            for _ in range(200):
                self.wfile.write(b'x')
                self.wfile.flush()
                time.sleep(0.05)
        except OSError:
            pass


class RealSocketTests(SimpleTestCase):
    """The stack below our own code: urllib3 private API and read1 are what could silently change."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), _LoopbackHandler)
        cls.server.daemon_threads = True
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base_url = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        super().tearDownClass()

    def setUp(self):
        _LoopbackHandler.hits = 0
        name_check = mock.patch('common.safe_http.check_public_http_url', return_value=(True, None))
        name_check.start()
        self.addCleanup(name_check.stop)

    def allow_loopback_peer(self):
        peer_check = mock.patch('common.safe_http.is_public_ip', return_value=True)
        peer_check.start()
        self.addCleanup(peer_check.stop)

    def test_rebinding_is_stopped_at_connect_before_any_request(self):
        # The name check passed (it is mocked to), yet the socket reached a private address.
        with self.assertRaises(FetchRefused) as refused:
            fetch_public_url(f'{self.base_url}/small', ONE_MEGABYTE, 5)
        self.assertEqual(refused.exception.code, REFUSED_INTERNAL_ADDRESS)
        self.assertEqual(_LoopbackHandler.hits, 0)

    def test_real_response_is_read(self):
        self.allow_loopback_peer()
        fetched = fetch_public_url(f'{self.base_url}/small', ONE_MEGABYTE, 5)
        self.assertEqual((fetched.content, fetched.content_type), (b'hello', 'image/png'))

    def test_huge_body_stops_at_the_limit(self):
        self.allow_loopback_peer()
        with self.assertRaises(FetchRefused) as refused:
            fetch_public_url(f'{self.base_url}/huge', ONE_MEGABYTE, 10)
        self.assertEqual(refused.exception.code, REFUSED_TOO_LARGE)

    def test_redirect_body_is_never_read(self):
        self.allow_loopback_peer()
        before = time.monotonic()
        fetched = fetch_public_url(f'{self.base_url}/redirect-with-endless-body', 1024, 5)
        self.assertEqual(fetched.content, b'hello')
        self.assertLess(time.monotonic() - before, 2)

    def test_compressed_bomb_is_measured_after_decoding(self):
        self.allow_loopback_peer()
        with self.assertRaises(FetchRefused) as refused:
            fetch_public_url(f'{self.base_url}/bomb', ONE_MEGABYTE, 10)
        self.assertEqual(refused.exception.code, REFUSED_TOO_LARGE)

    def test_slow_drip_cannot_outrun_the_deadline(self):
        self.allow_loopback_peer()
        started = time.monotonic()
        with self.assertRaises(FetchRefused) as refused:
            fetch_public_url(f'{self.base_url}/drip', ONE_MEGABYTE, 0.5)
        self.assertEqual(refused.exception.code, REFUSED_DEADLINE)
        self.assertLess(time.monotonic() - started, 2)

    def test_connection_failure_stays_a_requests_error(self):
        self.allow_loopback_peer()
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            unused_port = probe.getsockname()[1]
        with self.assertRaises(requests.RequestException):
            fetch_public_url(f'http://127.0.0.1:{unused_port}/', ONE_MEGABYTE, 2)


def _self_signed_certificate_files(directory):
    key = ec.generate_private_key(ec.SECP256R1())
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'untrusted.test')])
    now = datetime.now(timezone.utc)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(days=1))
        .not_valid_after(now + timedelta(days=1))
        .sign(key, hashes.SHA256())
    )
    certificate_path = Path(directory) / 'certificate.pem'
    key_path = Path(directory) / 'key.pem'
    certificate_path.write_bytes(certificate.public_bytes(serialization.Encoding.PEM))
    key_path.write_bytes(key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()
    ))
    return certificate_path, key_path


class RealTlsTests(SimpleTestCase):
    """The custom HTTPS connection class must keep both the peer check and certificate checks."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.directory = tempfile.TemporaryDirectory()
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(*_self_signed_certificate_files(cls.directory.name))
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), _LoopbackHandler)
        cls.server.daemon_threads = True
        cls.server.socket = context.wrap_socket(cls.server.socket, server_side=True)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f'https://127.0.0.1:{cls.server.server_port}/small'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.directory.cleanup()
        super().tearDownClass()

    def setUp(self):
        _LoopbackHandler.hits = 0
        name_check = mock.patch('common.safe_http.check_public_http_url', return_value=(True, None))
        name_check.start()
        self.addCleanup(name_check.stop)

    def test_private_peer_is_refused_before_the_tls_handshake(self):
        with self.assertRaises(FetchRefused) as refused:
            fetch_public_url(self.url, ONE_MEGABYTE, 5)
        self.assertEqual(refused.exception.code, REFUSED_INTERNAL_ADDRESS)

    def test_untrusted_certificate_is_rejected(self):
        with mock.patch('common.safe_http.is_public_ip', return_value=True):
            with self.assertRaises(requests.exceptions.SSLError):
                fetch_public_url(self.url, ONE_MEGABYTE, 5)
        self.assertEqual(_LoopbackHandler.hits, 0)
