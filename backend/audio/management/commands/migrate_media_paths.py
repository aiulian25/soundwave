"""Give every owner of a shared media file their own copy.

Dry run by default. Safe to stop and re-run: each row switches atomically and rows already
private are skipped. No file is moved or deleted; the last owner of a group keeps the original.
"""

import json
import os
import shutil
from collections import defaultdict
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand

from audio.models import Audio
from audio.storage_service import contained_media_path, ensure_private_file

JOURNAL_FILE_NAME = 'media_migration_journal.jsonl'
BYTES_PER_MEGABYTE = 1024 * 1024
# Leave room for downloads and the database while copying.
FREE_SPACE_MARGIN_BYTES = 1024 * BYTES_PER_MEGABYTE


def _shared_groups():
    groups = defaultdict(list)
    for audio in Audio.objects.exclude(file_path='').order_by('pk').iterator():
        groups[audio.file_path].append(audio)
    return {path: rows for path, rows in groups.items() if len(rows) > 1}


def _existing_size(file_path):
    path = contained_media_path(file_path)
    return path.stat().st_size if path is not None and path.is_file() else None


class Command(BaseCommand):
    help = 'Copy media shared between owners so each owner has their own file. Dry run unless --apply.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true', help='Copy files and update rows')
        parser.add_argument('--limit', type=int, default=None, help='Migrate at most this many rows')
        parser.add_argument(
            '--journal',
            default=os.path.join(settings.DATA_DIR, JOURNAL_FILE_NAME),
            help='Append-only record of each switched row, for audit and rollback',
        )

    def handle(self, *args, **options):
        groups = _shared_groups()
        sizes = {path: _existing_size(path) for path in groups}
        missing = [path for path, size in sizes.items() if size is None]
        # The last owner of each group keeps the original, so it needs no copy.
        bytes_needed = sum(size * (len(groups[path]) - 1) for path, size in sizes.items() if size)
        free_bytes = shutil.disk_usage(settings.MEDIA_ROOT).free

        self.stdout.write(
            f'{len(groups)} shared file(s) across {sum(len(rows) for rows in groups.values())} row(s); '
            f'{len(missing)} missing on disk; '
            f'{bytes_needed // BYTES_PER_MEGABYTE} MB needed, {free_bytes // BYTES_PER_MEGABYTE} MB free.'
        )

        if not options['apply']:
            self.stdout.write('Dry run: nothing changed. Re-run with --apply to migrate.')
            return

        if bytes_needed + FREE_SPACE_MARGIN_BYTES > free_bytes:
            self.stderr.write('Not enough free space; nothing changed. Use --limit or free some space.')
            return

        migrated, failed = self._migrate(groups, sizes, options['limit'], Path(options['journal']))
        self.stdout.write(f'Migrated {migrated} row(s); {failed} failed. Re-run to continue.')

    def _migrate(self, groups, sizes, limit, journal_path):
        migrated = 0
        failed = 0
        journal_path.parent.mkdir(parents=True, exist_ok=True)
        with journal_path.open('a', encoding='utf-8') as journal:
            for previous_path, rows in groups.items():
                if sizes[previous_path] is None:
                    continue
                for audio in rows[:-1]:
                    if limit is not None and migrated >= limit:
                        return migrated, failed
                    if not ensure_private_file(audio):
                        failed += 1
                        continue
                    migrated += 1
                    journal.write(json.dumps({
                        'audio_id': audio.pk,
                        'owner_id': audio.owner_id,
                        'previous_path': previous_path,
                        'new_path': audio.file_path,
                    }) + '\n')
                    journal.flush()
        return migrated, failed
