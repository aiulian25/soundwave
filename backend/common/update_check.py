"""Self-hosted update check.

Compares the running ``APP_VERSION`` against the latest GitHub Release. Runs entirely
server-side (so users' browsers are never exposed to GitHub) and is cached in Redis so
we never hammer the API. It *fails closed* — any network/parse error advertises "no
update" rather than raising into the request.
"""

import logging

import requests
from django.core.cache import cache

from config.version import APP_VERSION, GITHUB_REPO, GITHUB_REPO_URL

logger = logging.getLogger(__name__)

_CACHE_KEY = "app_update_info:v2"  # v2: cache only the GitHub lookup, never current_version
_CACHE_TTL = 6 * 60 * 60           # 6h on success
_CACHE_TTL_ERROR = 30 * 60         # 30m on failure (don't spam GitHub on flaky networks)
_GITHUB_API = f"https://api.github.com/repos/{GITHUB_REPO}/releases/latest"


def _parse_semver(value):
    """'v1.12.0' / '1.12.0' -> (1, 12, 0). Non-numeric suffixes are ignored."""
    out = []
    for part in (value or "").lstrip("vV").split(".")[:3]:
        digits = ""
        for ch in part:
            if ch.isdigit():
                digits += ch
            else:
                break
        out.append(int(digits) if digits else 0)
    while len(out) < 3:
        out.append(0)
    return tuple(out)


def _fetch_github():
    """Fetch the latest release from GitHub. Only this (remote) part is cached."""
    resp = requests.get(
        _GITHUB_API,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "SoundWave-UpdateCheck",
        },
        timeout=6,
    )
    resp.raise_for_status()
    data = resp.json()
    return {
        "latest_version": (data.get("tag_name") or "").lstrip("vV"),
        "release_url": data.get("html_url") or GITHUB_REPO_URL,
        "release_notes": data.get("body") or "",
        "published_at": data.get("published_at"),
        "checked": True,
    }


def get_update_info(force=False):
    """Return current/latest version and whether an update is available.

    ``current_version`` is the running build's APP_VERSION and is ALWAYS computed live —
    only the GitHub release lookup is cached. (Caching ``current_version`` would make an
    image upgrade keep reporting the old version until the cache expired, since Redis
    outlives the app container.) Never raises.
    """
    github = None if force else cache.get(_CACHE_KEY)
    if github is None:
        try:
            github = _fetch_github()
            cache.set(_CACHE_KEY, github, _CACHE_TTL)
        except Exception as exc:  # noqa: BLE001 - fail closed, never break the page
            logger.info("Update check skipped: %s", exc)
            github = {
                "latest_version": "",
                "release_url": GITHUB_REPO_URL,
                "release_notes": "",
                "published_at": None,
                "checked": False,
            }
            cache.set(_CACHE_KEY, github, _CACHE_TTL_ERROR)

    latest = github.get("latest_version") or APP_VERSION
    return {
        "current_version": APP_VERSION,
        "latest_version": latest,
        "update_available": _parse_semver(latest) > _parse_semver(APP_VERSION),
        "release_url": github.get("release_url") or GITHUB_REPO_URL,
        "release_notes": github.get("release_notes", ""),
        "published_at": github.get("published_at"),
        "repo_url": GITHUB_REPO_URL,
        "checked": github.get("checked", False),
    }
