"""Fetch a YouTube video's timed captions and convert them to LRC (F4).

Used as a synced-lyrics fallback when LRCLIB has nothing for a track. Prefers
human-authored subtitles, then auto-generated captions, in the requested languages.
The subtitle track URL comes from yt-dlp's metadata for a video id we control (not
user input); it is additionally checked against a trusted-host allow-list before fetch.
"""

import logging
import re
from urllib.parse import urlparse

import requests
import yt_dlp

logger = logging.getLogger(__name__)

# Subtitle track URLs are always YouTube/Google timedtext endpoints — allow-list them
# as a defence-in-depth SSRF guard even though the id is server-controlled.
_TRUSTED_CAPTION_HOST_SUFFIXES = ('.youtube.com', '.google.com', '.googlevideo.com')

_TIMEOUT = 15
_MIN_LINES = 3  # need a few timed lines to be worth showing


def _is_trusted_caption_url(url):
    try:
        host = (urlparse(url).hostname or '').lower()
    except Exception:
        return False
    return host == 'youtube.com' or any(host.endswith(s) for s in _TRUSTED_CAPTION_HOST_SUFFIXES)


def _pick_track(sub_map, lang_pref):
    """Pick the best subtitle track (a list of {ext,url} dicts) for preferred languages."""
    if not sub_map:
        return None
    # Exact language match first.
    for lang in lang_pref:
        if lang in sub_map:
            return sub_map[lang]
    # Prefix match (e.g. 'en' matches 'en-US', 'en-orig').
    for lang in lang_pref:
        base = lang.split('-')[0].lower()
        for key, track in sub_map.items():
            if key.split('-')[0].lower() == base:
                return track
    # Otherwise any available track.
    return next(iter(sub_map.values()), None)


def _fmt_lrc_time(seconds):
    minutes = int(seconds // 60)
    secs = seconds - minutes * 60
    return f"[{minutes:02d}:{secs:05.2f}]"


def _json3_to_lrc(data):
    """Convert YouTube 'json3' caption events to LRC lines."""
    lines = []
    for event in (data.get('events') or []):
        t_ms = event.get('tStartMs')
        if t_ms is None:
            continue
        text = ''.join(seg.get('utf8', '') for seg in (event.get('segs') or [])).strip()
        if not text:
            continue
        lines.append(f"{_fmt_lrc_time(t_ms / 1000.0)}{text}")
    return '\n'.join(lines)


def _vtt_to_lrc(text):
    """Convert a WebVTT track to LRC lines (start timestamp + cue text)."""
    lines = []
    ts_re = re.compile(r'(\d{2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->')
    for block in re.split(r'\n\s*\n', text):
        match = ts_re.search(block)
        if not match:
            continue
        h, m, s, ms = (int(match.group(i)) for i in range(1, 5))
        start = h * 3600 + m * 60 + s + ms / 1000.0
        text_parts = []
        seen_timing = False
        for ln in block.split('\n'):
            if '-->' in ln:
                seen_timing = True
                continue
            if seen_timing:
                clean = re.sub(r'<[^>]+>', '', ln).strip()  # strip inline karaoke tags
                if clean and not clean.isdigit():
                    text_parts.append(clean)
        if text_parts:
            lines.append(f"{_fmt_lrc_time(start)}{' '.join(text_parts)}")
    return '\n'.join(lines)


def fetch_captions_lrc(youtube_id, lang_pref=None):
    """Return a track's timed captions as LRC text, or None.

    Args:
        youtube_id: the video id.
        lang_pref: ordered language preferences (default ['en']).

    Returns:
        LRC string (``[mm:ss.xx] line``) or None when unavailable/unusable.
    """
    if not youtube_id:
        return None
    lang_pref = lang_pref or ['en']
    from task.tasks import get_yt_dlp_cookies_opts

    url = f"https://www.youtube.com/watch?v={youtube_id}"
    ydl_opts = {
        'quiet': True,
        'no_warnings': True,
        'skip_download': True,
        'subtitleslangs': lang_pref,
        **get_yt_dlp_cookies_opts(),
    }
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
    except Exception as exc:  # noqa: BLE001
        logger.info('Captions fetch failed for %s: %s', youtube_id, exc)
        return None
    if not info:
        return None

    # Human subtitles first, then auto-generated captions.
    track = (_pick_track(info.get('subtitles') or {}, lang_pref)
             or _pick_track(info.get('automatic_captions') or {}, lang_pref))
    if not track:
        return None

    # Prefer the structured json3 format, else WebVTT.
    fmt = None
    for want in ('json3', 'vtt'):
        fmt = next((f for f in track if f.get('ext') == want), None)
        if fmt:
            break
    if not fmt or not fmt.get('url') or not _is_trusted_caption_url(fmt['url']):
        return None

    try:
        resp = requests.get(fmt['url'], timeout=_TIMEOUT)
        resp.raise_for_status()
        lrc = _json3_to_lrc(resp.json()) if fmt.get('ext') == 'json3' else _vtt_to_lrc(resp.text)
    except Exception as exc:  # noqa: BLE001
        logger.info('Captions download/parse failed for %s: %s', youtube_id, exc)
        return None

    lrc = (lrc or '').strip()
    return lrc if lrc.count('\n') + 1 >= _MIN_LINES else None
