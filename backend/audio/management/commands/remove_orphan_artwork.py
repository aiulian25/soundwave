"""Remove kept artwork images that no track, playlist or channel points at any more.

Images of items deleted before deletions cleaned up after themselves were left on disk. Dry run by default; only files
directly inside the artwork folder are considered, and in-progress downloads are skipped.
"""

from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from audio.artwork_images import ARTWORK_SUBDIRECTORY, delete_artwork_file
from audio.models_artwork import Artwork

BYTES_PER_MEGABYTE = 1024 * 1024
PARTIAL_DOWNLOAD_PREFIX = '.'


class Command(BaseCommand):
    help = 'Delete artwork files nothing references. Dry run unless --apply.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Delete the files')

    def handle(self, *args, **options):
        artwork_folder = Path(settings.MEDIA_ROOT) / ARTWORK_SUBDIRECTORY
        if not artwork_folder.is_dir():
            self.stdout.write('No artwork folder; nothing to do.')
            return

        referenced = set(Artwork.objects.exclude(local_path='').values_list('local_path', flat=True))
        orphans = [
            image for image in sorted(artwork_folder.iterdir())
            if image.is_file()
            and not image.name.startswith(PARTIAL_DOWNLOAD_PREFIX)
            and str(image.relative_to(settings.MEDIA_ROOT)) not in referenced
        ]
        orphan_bytes = sum(image.stat().st_size for image in orphans)
        if options['apply']:
            orphans = [image for image in orphans if delete_artwork_file(str(image.relative_to(settings.MEDIA_ROOT)))]

        verb = 'Removed' if options['apply'] else 'Would remove'
        megabytes = orphan_bytes / BYTES_PER_MEGABYTE
        self.stdout.write(f'{verb} {len(orphans)} file(s), {megabytes:.1f} MB, that nothing references.')
