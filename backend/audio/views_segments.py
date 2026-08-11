"""Views for splitting a long mix into segments and listing them (F3).

Source precedence for the split: F2's captured `Audio.chapters` when present, otherwise
the tracklist parsed from `Audio.description`. Parsed parts are persisted as AudioSegment
rows AND (when the audio had no chapters) written into `Audio.chapters` so the player's
existing chapter/part UI immediately renders them as navigable parts.
"""

import logging

from django.shortcuts import get_object_or_404
from rest_framework import status
from rest_framework.response import Response

from audio.models import Audio
from audio.models_segments import AudioSegment
from audio.serializers_segments import AudioSegmentSerializer
from audio.serializers import AudioSerializer
from audio.tracklist_parser import parse_tracklist
from common.views import ApiBaseView

logger = logging.getLogger(__name__)


def _segments_from_chapters(chapters, duration):
    """Normalize F2 chapter dicts into [{title,start,end}], deriving missing ends."""
    parts = []
    valid = [c for c in (chapters or []) if isinstance(c, dict) and isinstance(c.get('start'), (int, float))]
    valid.sort(key=lambda c: c.get('start') or 0)
    try:
        total = int(duration)
    except (TypeError, ValueError):
        total = 0
    for i, ch in enumerate(valid):
        start = float(ch.get('start') or 0)
        end = ch.get('end')
        if not isinstance(end, (int, float)):
            end = valid[i + 1].get('start') if i + 1 < len(valid) else (total or start)
        end = float(end)
        if total and end > total:
            end = float(total)
        if end <= start:
            continue
        parts.append({'title': ch.get('title', '') or '', 'start': start, 'end': end})
    return parts


class AudioSplitView(ApiBaseView):
    """POST: split a mix into segments from its chapters/description tracklist."""

    def post(self, request, youtube_id):
        audio = get_object_or_404(Audio, youtube_id=youtube_id, owner=request.user)

        # Prefer F2 chapters; fall back to parsing the stored description.
        parts = _segments_from_chapters(audio.chapters, audio.duration)
        from_description = False
        if len(parts) < 2:
            parts = parse_tracklist(audio.description, audio.duration)
            from_description = True

        if len(parts) < 2:
            return Response(
                {'error': 'No tracklist found in chapters or description.', 'code': 'no_tracklist'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Idempotent: replace any prior split for this audio.
        AudioSegment.objects.filter(audio=audio).delete()
        AudioSegment.objects.bulk_create([
            AudioSegment(
                audio=audio,
                title=p['title'],
                start_seconds=p['start'],
                end_seconds=p['end'],
                order=i,
            )
            for i, p in enumerate(parts)
        ])

        # If the parts came from the description (no chapters yet), surface them via the
        # existing chapter/part player UI so the split is immediately navigable.
        if from_description and not audio.chapters:
            audio.chapters = [
                {'title': p['title'], 'start': p['start'], 'end': p['end']} for p in parts
            ]
            audio.save(update_fields=['chapters'])

        segments = AudioSegment.objects.filter(audio=audio)
        return Response(
            {
                'count': segments.count(),
                'segments': AudioSegmentSerializer(segments, many=True).data,
                'audio': AudioSerializer(audio).data,
            },
            status=status.HTTP_201_CREATED,
        )


class AudioSegmentsView(ApiBaseView):
    """GET: list the segments previously created for a mix."""

    def get(self, request, youtube_id):
        audio = get_object_or_404(Audio, youtube_id=youtube_id, owner=request.user)
        segments = AudioSegment.objects.filter(audio=audio)
        return Response({'segments': AudioSegmentSerializer(segments, many=True).data})
