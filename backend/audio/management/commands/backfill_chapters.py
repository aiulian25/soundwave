"""Backfill chapter markers (F2) for already-downloaded YouTube tracks.

Re-fetches `chapters` via yt-dlp in metadata-only mode (download=False) for Audio rows
that have a youtube_id but no chapters yet, and stores them in the new `chapters` field.

Usage:
    python manage.py backfill_chapters [--limit N] [--owner <username>] [--force]
"""

import time

from django.core.management.base import BaseCommand

from audio.models import Audio


class Command(BaseCommand):
    help = "Backfill chapter markers for existing downloaded tracks via yt-dlp (metadata only)."

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=100,
                            help='Maximum number of tracks to process (default 100).')
        parser.add_argument('--owner', type=str, default=None,
                            help='Restrict to a single owner username.')
        parser.add_argument('--force', action='store_true',
                            help='Re-fetch even for tracks that already have chapters.')
        parser.add_argument('--delay', type=float, default=1.0,
                            help='Seconds to sleep between fetches (rate-limit friendliness).')

    def handle(self, *args, **options):
        import yt_dlp
        # Reuse the same cookies handling as the downloader.
        from task.tasks import get_yt_dlp_cookies_opts

        qs = Audio.objects.exclude(youtube_id='').exclude(youtube_id__isnull=True)
        if not options['force']:
            # Only rows with an empty/absent chapters list.
            qs = qs.filter(chapters=[])
        if options['owner']:
            qs = qs.filter(owner__username=options['owner'])
        qs = qs.order_by('-downloaded_date')[:options['limit']]

        total = qs.count()
        self.stdout.write(f"Backfilling chapters for up to {total} track(s)...")

        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'skip_download': True,
            'extract_flat': False,
            **get_yt_dlp_cookies_opts(),
        }

        updated = 0
        with_chapters = 0
        failed = 0
        for audio in qs:
            url = f"https://www.youtube.com/watch?v={audio.youtube_id}"
            try:
                with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                    info = ydl.extract_info(url, download=False)
                chapters = [
                    {'title': c.get('title', ''), 'start': c.get('start_time'), 'end': c.get('end_time')}
                    for c in (info.get('chapters') or [])
                ]
                audio.chapters = chapters
                audio.save(update_fields=['chapters'])
                updated += 1
                if chapters:
                    with_chapters += 1
                    self.stdout.write(f"  {audio.youtube_id}: {len(chapters)} chapter(s)")
            except Exception as exc:  # noqa: BLE001 — per-row resilience
                failed += 1
                self.stderr.write(f"  {audio.youtube_id}: failed ({exc})")
            if options['delay'] > 0:
                time.sleep(options['delay'])

        self.stdout.write(self.style.SUCCESS(
            f"Done. Updated {updated} ({with_chapters} had chapters), {failed} failed."
        ))
