"""Pure sonic-similarity + Auto-DJ math for radio (F16).

Deliberately free of librosa/numpy so this module (and its tests) load in the base image
without the heavy DSP stack — only extract_features_task imports librosa, lazily. Everything
here operates on plain lists / model instances, so the similarity and energy-curve logic is
fully unit-testable without any audio files.
"""

import math

# --- feature-vector normalization constants -----------------------------------------------
FEATURE_VECTOR_DIM = 7
_ENERGY_RMS_CEILING = 0.3        # RMS ~0.3 treated as "loud" -> maps to 1.0
_TEMPO_MAX_BPM = 200.0
_CENTROID_MAX_HZ = 8000.0
_ROLLOFF_MAX_HZ = 11025.0        # ~Nyquist/2 at sr=22050
_PITCH_CLASSES = 12

KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

# --- Auto-DJ energy curves ----------------------------------------------------------------
CURVE_FOCUS = 'focus'
CURVE_PARTY = 'party'
CURVE_WINDDOWN = 'winddown'
ENERGY_CURVES = (CURVE_FOCUS, CURVE_PARTY, CURVE_WINDDOWN)
DEFAULT_CURVE = CURVE_FOCUS

# How many positions the curve spans before it plateaus at its terminal target.
AUTODJ_SESSION_LENGTH = 25

# Bound the in-memory candidate scan so a huge library can't create an unbounded cosine pass.
CANDIDATE_POOL_LIMIT = 400
HIGH_SKIP_THRESHOLD = 3


def _num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _clip01(value):
    number = _num(value)
    if number < 0.0:
        return 0.0
    if number > 1.0:
        return 1.0
    return number


def energy_from_rms(rms):
    """Map a raw RMS reading to a normalized 0..1 energy."""
    return _clip01(_num(rms) / _ENERGY_RMS_CEILING)


def build_feature_vector(energy, bpm, spectral_centroid_hz, zcr, rolloff_hz, key_index):
    """Map raw DSP scalars to a normalized 7-dim vector in [0,1] (no librosa).

    Musical key is encoded CYCLICALLY (sin/cos of the pitch class) across two dimensions so
    adjacent/enharmonic keys are near and the C<->B wrap is respected — a linear key index
    would wrongly place C and B maximally apart.
    """
    key_angle = 2.0 * math.pi * (_num(key_index) % _PITCH_CLASSES) / _PITCH_CLASSES
    return [
        _clip01(energy),
        _clip01(_num(bpm) / _TEMPO_MAX_BPM),
        _clip01(_num(spectral_centroid_hz) / _CENTROID_MAX_HZ),
        _clip01(zcr),
        _clip01(_num(rolloff_hz) / _ROLLOFF_MAX_HZ),
        (math.sin(key_angle) + 1.0) / 2.0,
        (math.cos(key_angle) + 1.0) / 2.0,
    ]


def cosine_distance(a, b):
    """Cosine distance in [0,1] for non-negative vectors; 1.0 (max) on any degenerate input."""
    if not a or not b or len(a) != len(b):
        return 1.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 1.0
    similarity = dot / (norm_a * norm_b)
    similarity = max(-1.0, min(1.0, similarity))
    return 1.0 - similarity


def feature_distance(a, b):
    """Euclidean (L2) distance over [0,1]-boxed feature vectors — the metric used for sonic
    ranking. Preferred over cosine here: the features are already per-dimension normalized, so
    magnitude differences (a loud/fast track vs a quiet/slow one) must count, and cosine is
    magnitude-invariant. Returns +inf on degenerate/mismatched input so such tracks rank last.
    """
    if not a or not b or len(a) != len(b):
        return float('inf')
    return math.sqrt(sum((x - y) ** 2 for x, y in zip(a, b)))


def rank_by_sonic_distance(seed_vector, tracks, seed_channel_id=None, seed_genre=''):
    """Return tracks (with a feature_vector) sorted nearest-first by Euclidean feature distance
    to the seed, breaking ties toward the same artist/genre."""
    scored = []
    for track in tracks:
        vector = getattr(track, 'feature_vector', None)
        if not vector:
            continue
        distance = feature_distance(seed_vector, vector)
        same_artist_or_genre = bool(
            (seed_channel_id and getattr(track, 'channel_id', '') == seed_channel_id)
            or (seed_genre and getattr(track, 'genre', '') == seed_genre)
        )
        scored.append((distance, 0 if same_artist_or_genre else 1, track))
    scored.sort(key=lambda item: (item[0], item[1]))
    return [track for _distance, _tie, track in scored]


def energy_target(curve, progress):
    """Target energy 0..1 for a position `progress` (0..1) along an Auto-DJ curve.

    winddown is strictly decreasing (0.9 -> 0.1); party builds to a sustained peak; focus
    warms up to a steady moderate level.
    """
    p = 0.0 if progress < 0.0 else 1.0 if progress > 1.0 else progress
    if curve == CURVE_WINDDOWN:
        return max(0.9 - 0.8 * p, 0.1)
    if curve == CURVE_PARTY:
        return min(0.4 + 1.5 * p, 1.0)
    # focus (default): gentle warm-up to a stable ~0.6
    return 0.45 + 0.15 * min(p / 0.2, 1.0)


def nearest_by_energy(target, tracks):
    """Return tracks (with an energy value) sorted by |energy - target| ascending."""
    scored = []
    for track in tracks:
        energy = getattr(track, 'energy', None)
        if energy is None:
            continue
        scored.append((abs(_num(energy) - target), track))
    scored.sort(key=lambda item: item[0])
    return [track for _distance, track in scored]


def high_skip_youtube_ids(user, min_skips=HIGH_SKIP_THRESHOLD):
    """youtube_ids this user has skipped at least `min_skips` times (durable, owner-scoped)."""
    from django.db.models import Count
    from audio.models_radio import RadioTrackFeedback

    rows = (
        RadioTrackFeedback.objects
        .filter(user=user, feedback_type='skipped')
        .values('youtube_id')
        .annotate(skip_count=Count('id'))
        .filter(skip_count__gte=min_skips)
    )
    return {row['youtube_id'] for row in rows}
