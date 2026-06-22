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

_CACHE_KEY = "app_update_info:v1"
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


def _base_info():
    return {
        "current_version": APP_VERSION,
        "latest_version": APP_VERSION,
        "update_available": False,
        "release_url": GITHUB_REPO_URL,
        "release_notes": "",
        "published_at": None,
        "repo_url": GITHUB_REPO_URL,
        "checked": False,
    }


def get_update_info(force=False):
    """Return current/latest version and whether an update is available (cached, never raises)."""
    if not force:
        cached = cache.get(_CACHE_KEY)
        if cached is not None:
            return cached

    info = _base_info()
    try:
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

        latest = (data.get("tag_name") or "").lstrip("vV")
        info.update(
            {
                "latest_version": latest or APP_VERSION,
                "release_url": data.get("html_url") or GITHUB_REPO_URL,
                "release_notes": data.get("body") or "",
                "published_at": data.get("published_at"),
                "checked": True,
            }
        )
        if latest:
            info["update_available"] = _parse_semver(latest) > _parse_semver(APP_VERSION)
        cache.set(_CACHE_KEY, info, _CACHE_TTL)
        return info
    except Exception as exc:  # noqa: BLE001 - fail closed, never break the page
        logger.info("Update check skipped: %s", exc)
        cache.set(_CACHE_KEY, info, _CACHE_TTL_ERROR)
        return info
