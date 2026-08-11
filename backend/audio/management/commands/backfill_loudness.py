"""Backfill integrated loudness (LUFS) for already-downloaded tracks (F9).

Measures EBU R128 integrated loudness via ffmpeg for Audio rows that have a file but no
`loudness_lufs` yet, so the player can normalize their playback volume.

Usage:
    python manage.py backfill_loudness [--limit N] [--owner <username>] [--force]
"""

import os

from django.conf import settings
from django.core.management.base import BaseCommand

from audio.models import Audio


class Command(BaseCommand):
    help = "Backfill integrated loudness (LUFS) for existing downloaded tracks via ffmpeg."

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=100,
                            help='Maximum number of tracks to process (default 100).')
        parser.add_argument('--owner', type=str, default=None,
                            help='Restrict to a single owner username.')
        parser.add_argument('--force', action='store_true',
                            help='Re-measure even for tracks that already have loudness_lufs.')

    def handle(self, *args, **options):
        from task.tasks import measure_loudness_lufs

        media_root = getattr(settings, 'MEDIA_ROOT', '/app/audio')

        qs = Audio.objects.exclude(file_path='').exclude(file_path__isnull=True)
        if not options['force']:
            qs = qs.filter(loudness_lufs__isnull=True)
        if options['owner']:
            qs = qs.filter(owner__username=options['owner'])
        qs = qs.order_by('-downloaded_date')[:options['limit']]

        total = qs.count()
        self.stdout.write(f"Measuring loudness for up to {total} track(s)...")

        measured = 0
        skipped = 0
        for audio in qs:
            path = os.path.join(media_root, audio.file_path)
            lufs = measure_loudness_lufs(path)
            if lufs is None:
                skipped += 1
                self.stderr.write(f"  {audio.youtube_id or audio.id}: not measured")
                continue
            audio.loudness_lufs = lufs
            audio.save(update_fields=['loudness_lufs'])
            measured += 1
            self.stdout.write(f"  {audio.youtube_id or audio.id}: {lufs} LUFS")

        self.stdout.write(self.style.SUCCESS(f"Done. Measured {measured}, skipped {skipped}."))
