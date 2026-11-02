"""What LRC text means, as one contract shared by upload, tag writing and the player.

- A line starts with one or more `[m:ss]`, `[mm:ss.x]`, `[mm:ss.xx]` or `[mm:ss.xxx]` stamps;
  minutes are unbounded. A shorter fraction is a decimal, so `.5` is 500 ms.
- Each stamp on a line is its own event with the same text.
- `[offset:N]` shifts everything once by N milliseconds: positive means earlier, as in the LRC
  format's own definition. Times never go below zero.
- Lines without text, untimed lines and other metadata tags produce no event.
- Events are in time order; equal times keep their order in the source.

Events written back out take one canonical form, `[mm:ss.xxx]text`, one stamp per line and no
offset tag, and parse to exactly the same events.

frontend/src/utils/lrc.ts implements the same contract, and both are tested against
audio/tests/fixtures/lrc_contract.json.
"""

import re
from typing import NamedTuple

LRC_TIMESTAMP_PATTERN = r'\[\d+:\d{2}(?:\.\d{1,3})?\]'

_STAMP_PARTS_RE = re.compile(r'\[(\d+):(\d{2})(?:\.(\d{1,3}))?\]')
_TIMED_LINE_RE = re.compile(rf'^\s*((?:{LRC_TIMESTAMP_PATTERN}\s*)+)(.*)$')
_OFFSET_TAG_RE = re.compile(r'^\s*\[offset:\s*([+-]?\d+)\s*\]\s*$', re.IGNORECASE | re.MULTILINE)
_MILLISECONDS_PER_SECOND = 1000
_SECONDS_PER_MINUTE = 60
_FRACTION_DIGITS = 3


class LyricEvent(NamedTuple):
    time_ms: int
    text: str


def _stamp_milliseconds(minutes, seconds, fraction):
    whole_seconds = int(minutes) * _SECONDS_PER_MINUTE + int(seconds)
    fraction_ms = int((fraction or '').ljust(_FRACTION_DIGITS, '0'))
    return whole_seconds * _MILLISECONDS_PER_SECOND + fraction_ms


def offset_tag_line(lrc_text):
    """The source's `[offset:N]` line, if it has one, for keeping beside the timed lines."""
    match = _OFFSET_TAG_RE.search(lrc_text or '')
    return match.group(0).strip() if match else ''


def text_without_timing(lrc_text):
    """LRC text for reading: no stamps and no offset tag."""
    return re.sub(LRC_TIMESTAMP_PATTERN, '', _OFFSET_TAG_RE.sub('', lrc_text or ''))


def parse_lrc(lrc_text):
    """Every lyric event in LRC text, in time order."""
    text_source = lrc_text or ''
    offset_match = _OFFSET_TAG_RE.search(text_source)
    offset_ms = int(offset_match.group(1)) if offset_match else 0

    events = []
    for line in text_source.splitlines():
        match = _TIMED_LINE_RE.match(line)
        if not match:
            continue
        text = match.group(2).strip()
        if not text:
            continue
        for parts in _STAMP_PARTS_RE.findall(match.group(1)):
            events.append(LyricEvent(max(_stamp_milliseconds(*parts) - offset_ms, 0), text))
    return sorted(events, key=lambda event: event.time_ms)


def format_lrc(events):
    """Lyric events as canonical LRC text."""
    lines = []
    for event in events:
        whole_seconds, milliseconds = divmod(event.time_ms, _MILLISECONDS_PER_SECOND)
        minutes, seconds = divmod(whole_seconds, _SECONDS_PER_MINUTE)
        lines.append(f'[{minutes:02d}:{seconds:02d}.{milliseconds:03d}]{event.text}')
    return '\n'.join(lines)
