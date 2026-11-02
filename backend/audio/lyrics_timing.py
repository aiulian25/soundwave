"""Saving new timing for a track's lyrics: the words stay, and only the times may change."""

from collections import Counter

from django.db import transaction

from audio.lrc import format_lrc, parse_lrc
from audio.models_lyrics import Lyrics

MILLISECONDS_PER_SECOND = 1000
# Stored durations are rounded, so a last line can legitimately start just past one.
DURATION_TOLERANCE_MS = 1000

NO_SYNCED_LYRICS_MESSAGE = 'This track has no timed lyrics to adjust.'
NO_LINES_MESSAGE = 'No timed lines were found.'
TEXT_CHANGED_MESSAGE = 'Only the timing can change here; the words differ from the saved lyrics.'
PAST_END_MESSAGE = 'A line starts after the end of the track.'
LYRICS_CHANGED_MESSAGE = 'These lyrics changed since you started editing.'
MANUAL_SOURCE = 'manual'


class InvalidLyricsTiming(Exception):
    """The proposed timing cannot be saved as it stands."""


class LyricsChanged(Exception):
    """The lyrics are no longer the revision the edit started from."""

    def __init__(self, current):
        super().__init__(LYRICS_CHANGED_MESSAGE)
        self.current = current


def _words(events):
    return Counter(event.text for event in events)


def _validate(events, current_events, duration_seconds):
    if not events:
        raise InvalidLyricsTiming(NO_LINES_MESSAGE)
    if _words(events) != _words(current_events):
        raise InvalidLyricsTiming(TEXT_CHANGED_MESSAGE)

    latest_allowed_ms = duration_seconds * MILLISECONDS_PER_SECOND + DURATION_TOLERANCE_MS
    if duration_seconds and events[-1].time_ms > latest_allowed_ms:
        raise InvalidLyricsTiming(PAST_END_MESSAGE)


def _original_to_keep(lyrics, current_events):
    """The first timing, unless the lyrics were since replaced by different words."""
    original = lyrics.original_synced_lyrics
    if original and _words(parse_lrc(original)) == _words(current_events):
        return original
    return lyrics.synced_lyrics


@transaction.atomic
def save_lyrics_timing(audio, synced_lyrics, base_revision):
    lyrics = Lyrics.objects.select_for_update().filter(audio=audio).first()
    if lyrics is None or not lyrics.synced_lyrics:
        raise InvalidLyricsTiming(NO_SYNCED_LYRICS_MESSAGE)
    if lyrics.revision != base_revision:
        raise LyricsChanged(lyrics)

    events = parse_lrc(synced_lyrics)
    current_events = parse_lrc(lyrics.synced_lyrics)
    _validate(events, current_events, audio.duration)

    lyrics.original_synced_lyrics = _original_to_keep(lyrics, current_events)
    lyrics.synced_lyrics = format_lrc(events)
    lyrics.source = MANUAL_SOURCE
    lyrics.fetch_attempted = True
    lyrics.save()
    return lyrics
