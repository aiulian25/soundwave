"""
SSRF protection for user-supplied URLs (APP-02).

Validates that a URL is a public http(s) resource before the application fetches
it (e.g. handing a download URL to yt-dlp). Blocks non-http(s) schemes and any
host that resolves to a loopback/private/link-local/reserved address, which would
otherwise let an authenticated user reach internal services (Elasticsearch,
Postgres, the cloud metadata endpoint, etc.).

This is the application-layer control. The durable, defence-in-depth control is to
run the download worker on an egress-restricted network — see SECURITY_ASSESSMENT.md
APP-02. Note the TOCTOU caveat: DNS may re-resolve between this check and the actual
fetch, so this is necessary but not by itself sufficient.
"""

import ipaddress
import socket
from urllib.parse import urlparse

ALLOWED_SCHEMES = {'http', 'https'}

# Stable codes returned to callers so the SPA can localize the message.
# Keep in sync with the `downloadStatus.errors.*` keys in the locale files.
ERROR_MESSAGES = {
    'invalid_url': 'Enter a valid URL.',
    'bad_scheme': 'Only http and https URLs are allowed.',
    'unresolvable': 'The URL host could not be resolved.',
    'internal_address': 'This URL points to a non-routable or internal address and is not allowed.',
}


def _ip_is_blocked(ip: ipaddress._BaseAddress) -> bool:
    """Return True for any address that must not be reachable from a fetcher."""
    # IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) — evaluate the embedded v4 address.
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return (
        ip.is_loopback        # 127.0.0.0/8, ::1
        or ip.is_private      # 10/8, 172.16/12, 192.168/16, fc00::/7
        or ip.is_link_local   # 169.254.0.0/16, fe80::/10
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified  # 0.0.0.0, ::
    )


def check_public_http_url(value: str):
    """Validate a URL is a safe, public http(s) target.

    Returns a tuple ``(ok: bool, code: str | None)``. ``code`` is one of the keys
    in :data:`ERROR_MESSAGES` when ``ok`` is False.
    """
    if not value or not isinstance(value, str):
        return False, 'invalid_url'

    try:
        parsed = urlparse(value.strip())
    except Exception:
        return False, 'invalid_url'

    if parsed.scheme.lower() not in ALLOWED_SCHEMES:
        return False, 'bad_scheme'

    host = parsed.hostname
    if not host:
        return False, 'invalid_url'

    # A bare IP literal can be checked without DNS.
    try:
        literal_ip = ipaddress.ip_address(host)
    except ValueError:
        literal_ip = None
    if literal_ip is not None:
        return (False, 'internal_address') if _ip_is_blocked(literal_ip) else (True, None)

    # Resolve the hostname and reject if ANY resolved address is internal.
    port = parsed.port or (443 if parsed.scheme.lower() == 'https' else 80)
    try:
        infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
    except socket.gaierror:
        return False, 'unresolvable'
    except (UnicodeError, OSError):
        return False, 'invalid_url'

    if not infos:
        return False, 'unresolvable'

    for info in infos:
        sockaddr = info[4]
        try:
            ip = ipaddress.ip_address(sockaddr[0])
        except ValueError:
            return False, 'internal_address'
        if _ip_is_blocked(ip):
            return False, 'internal_address'

    return True, None


def message_for(code: str) -> str:
    """Human-readable message for a rejection code."""
    return ERROR_MESSAGES.get(code, ERROR_MESSAGES['invalid_url'])
