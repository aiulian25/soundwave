"""Correct stored track sizes from the files on disk, which quota accounting now relies on.

Older downloads stored the size upstream metadata reported, often 0. Dry run by default;
never touches files, and a missing file leaves its row alone.
"""

from django.core.management.base import BaseCommand

from audio.models import Audio
from audio.storage_service import contained_media_path

BYTES_PER_MEGABYTE = 1024 * 1024


class Command(BaseCommand):
    help = 'Set Audio.file_size from the file on disk. Dry run unless --apply.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Update the rows')
        parser.add_argument('--limit', type=int, default=None, help='Check at most this many rows')

    def handle(self, *args, **options):
        audio_rows = Audio.objects.exclude(file_path='').order_by('pk')
        if options['limit'] is not None:
            audio_rows = audio_rows[:options['limit']]

        changed = 0
        missing = 0
        difference_bytes = 0
        for audio in audio_rows.iterator():
            path = contained_media_path(audio.file_path)
            if path is None or not path.is_file():
                missing += 1
                continue
            actual_bytes = path.stat().st_size
            if actual_bytes == audio.file_size:
                continue
            changed += 1
            difference_bytes += actual_bytes - audio.file_size
            if options['apply']:
                Audio.objects.filter(pk=audio.pk).update(file_size=actual_bytes)

        verb = 'Updated' if options['apply'] else 'Would update'
        self.stdout.write(
            f'{verb} {changed} row(s), a difference of {difference_bytes // BYTES_PER_MEGABYTE} MB; '
            f'{missing} file(s) missing on disk.'
        )
