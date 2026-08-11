"""Parse a timestamped tracklist out of a mix's description (F3).

Mixes/DJ sets routinely carry a tracklist in the video description, e.g.:

    0:00 Intro
    3:20 Artist - Song
    1:07:10 [Closer]

`parse_tracklist(description, duration)` extracts those into ordered segments
``[{'title', 'start', 'end'}]`` where each segment ends where the next begins (the last
ends at ``duration``). Returns ``[]`` when fewer than two timestamped lines are found, so
callers can show a friendly "no tracklist" message instead of producing a bogus split.
"""

import re

# A timestamped line: optional leading "1." / "1)" ordinal, optional [ / ( bracket,
# then H:M:S or M:S, an optional separator, then the title.
_TS_RE = re.compile(
    r'^\s*'
    r'(?:\d{1,3}[.)]\s*)?'                              # optional "1." / "1)"
    r'[\[(]?'                                           # optional [ or (
    r'(?P<h>\d{1,2}:)?(?P<m>\d{1,2}):(?P<s>\d{2})'      # H:M:S or M:S
    r'[\])]?'                                           # optional ] or )
    r'\s*[-–—:.]?\s*'                                   # optional separator
    r'(?P<title>.+?)\s*$'
)


def _to_seconds(h, m, s):
    hours = int(h[:-1]) if h else 0  # h captured as e.g. "1:"
    return hours * 3600 + int(m) * 60 + int(s)


def parse_tracklist(description, duration):
    """Return ordered segments parsed from a description tracklist.

    Args:
        description: the video description text (may be empty/None).
        duration: total track length in seconds (used as the final segment's end).

    Returns:
        A list of ``{'title': str, 'start': int, 'end': int}`` ordered by start, or ``[]``
        when no usable tracklist (< 2 timestamps) is present.
    """
    if not description:
        return []

    parsed = []
    for line in description.splitlines():
        match = _TS_RE.match(line)
        if not match:
            continue
        start = _to_seconds(match.group('h'), match.group('m'), match.group('s'))
        title = match.group('title').strip().strip('-–—:').strip()
        if not title:
            continue
        parsed.append({'start': start, 'title': title})

    if len(parsed) < 2:
        return []

    parsed.sort(key=lambda seg: seg['start'])

    try:
        total = int(duration)
    except (TypeError, ValueError):
        total = 0
    if total <= 0:
        total = parsed[-1]['start'] + 1  # best-effort when duration is unknown

    segments = []
    for i, seg in enumerate(parsed):
        start = seg['start']
        if start >= total:          # ignore timestamps beyond the track length
            continue
        end = parsed[i + 1]['start'] if i + 1 < len(parsed) else total
        end = min(end, total)
        if end <= start:            # skip zero/negative-length segments
            continue
        segments.append({'title': seg['title'], 'start': start, 'end': end})

    return segments
