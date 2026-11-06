"""Bounded fetching of user-influenced URLs: every hop validated, bytes and time capped.

Addresses are checked twice. Before a request, `check_public_http_url` gives a clear refusal.
On connect, the peer actually reached is checked before any HTTP bytes are sent, which closes
DNS rebinding between the two. Egress policy is still the backstop: see README.
"""

import time
from dataclasses import dataclass
from urllib.parse import urljoin

import requests
from requests.adapters import HTTPAdapter
from requests.utils import default_headers
from urllib3.connection import HTTPConnection, HTTPSConnection
from urllib3.connectionpool import HTTPConnectionPool, HTTPSConnectionPool

from common.url_security import check_public_http_url, is_public_ip

MAX_REDIRECTS = 5
READ_CHUNK_BYTES = 64 * 1024
HTTP_OK = 200
# Explicit: importing yt-dlp replaces requests' select_proxy with one that rejects None.
NO_PROXIES = {}

REFUSED_INTERNAL_ADDRESS = 'internal_address'
REFUSED_TOO_MANY_REDIRECTS = 'too_many_redirects'
REFUSED_TOO_LARGE = 'too_large'
REFUSED_DEADLINE = 'deadline_exceeded'
REFUSED_UPSTREAM_STATUS = 'upstream_status'


class FetchRefused(Exception):
    """The fetch was stopped by policy; `code` is a stable reason. Network errors stay `requests` errors."""

    def __init__(self, code, status_code=None):
        super().__init__(code)
        self.code = code
        # Set for REFUSED_UPSTREAM_STATUS, so callers can tell "gone" from "try again later".
        self.status_code = status_code


@dataclass(frozen=True)
class FetchedResponse:
    content: bytes
    content_type: str


class _PublicPeerMixin:
    def _new_conn(self):
        connection = super()._new_conn()
        if not is_public_ip(connection.getpeername()[0]):
            connection.close()
            raise FetchRefused(REFUSED_INTERNAL_ADDRESS)
        return connection


class _PublicHTTPConnection(_PublicPeerMixin, HTTPConnection):
    pass


class _PublicHTTPSConnection(_PublicPeerMixin, HTTPSConnection):
    pass


class _PublicHTTPPool(HTTPConnectionPool):
    ConnectionCls = _PublicHTTPConnection


class _PublicHTTPSPool(HTTPSConnectionPool):
    ConnectionCls = _PublicHTTPSConnection


class _PublicOnlyAdapter(HTTPAdapter):
    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        self.close()

    def init_poolmanager(self, *args, **kwargs):
        super().init_poolmanager(*args, **kwargs)
        self.poolmanager.pool_classes_by_scheme = {'http': _PublicHTTPPool, 'https': _PublicHTTPSPool}


def _prepared_get(url):
    return requests.Request('GET', url, headers=default_headers()).prepare()


def _require_public(url):
    is_public, code = check_public_http_url(url)
    if not is_public:
        raise FetchRefused(code)


def _remaining_seconds(deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise FetchRefused(REFUSED_DEADLINE)
    return remaining


def _read_body(response, max_bytes, deadline):
    """read1 returns after one socket read, so a slow-drip server cannot outrun the deadline."""
    if response.status_code != HTTP_OK:
        raise FetchRefused(REFUSED_UPSTREAM_STATUS, response.status_code)
    body = bytearray()
    while chunk := response.raw.read1(READ_CHUNK_BYTES, decode_content=True):
        body += chunk
        if len(body) > max_bytes:
            raise FetchRefused(REFUSED_TOO_LARGE)
        _remaining_seconds(deadline)
    return FetchedResponse(bytes(body), response.headers.get('content-type', ''))


def fetch_public_url(url, max_bytes, timeout_seconds):
    """GET a public URL, following only redirects that are themselves validated.

    Raises FetchRefused for policy stops, or a `requests` exception for network failures.
    """
    deadline = time.monotonic() + timeout_seconds
    # The adapter directly, not a Session: Session.send reads a redirect's whole body even with
    # allow_redirects=False, and environment proxies would make the peer check see the proxy.
    with _PublicOnlyAdapter() as adapter:
        for _ in range(MAX_REDIRECTS + 1):
            _require_public(url)
            with adapter.send(
                _prepared_get(url), stream=True, timeout=_remaining_seconds(deadline), proxies=NO_PROXIES
            ) as response:
                if not response.is_redirect:
                    return _read_body(response, max_bytes, deadline)
                url = urljoin(url, response.headers['location'])
    raise FetchRefused(REFUSED_TOO_MANY_REDIRECTS)
