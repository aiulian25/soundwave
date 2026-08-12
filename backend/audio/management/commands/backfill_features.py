"""Backfill sonic audio features (tempo/key/energy + 7-dim vector) for downloaded tracks (F16).

Enqueues extract_features_task (librosa runs on the Celery worker) for Audio rows that have a
file but no feature_vector yet, so Sonic radio / Auto-DJ can rank them acoustically.

Usage:
    python manage.py backfill_features [--limit N] [--owner <username>] [--all] [--sync]
"""

from django.core.management.base import BaseCommand

from audio.models import Audio


class Command(BaseCommand):
    help = "Backfill sonic audio features for existing downloaded tracks (enqueues librosa extraction)."

    def add_arguments(self, parser):
        parser.add_argument('--limit', type=int, default=500,
                            help='Maximum number of tracks to process (default 500).')
        parser.add_argument('--owner', type=str, default=None,
                            help='Restrict to a single owner username.')
        parser.add_argument('--all', action='store_true',
                            help='Re-extract even for tracks that already have a feature_vector.')
        parser.add_argument('--sync', action='store_true',
                            help='Run extraction in-process instead of enqueuing (needs librosa locally).')

    def handle(self, *args, **options):
        from task.tasks import extract_features_task

        queryset = Audio.objects.exclude(file_path='').exclude(file_path__isnull=True)
        if not options['all']:
            queryset = queryset.filter(feature_vector=[])
        if options['owner']:
            queryset = queryset.filter(owner__username=options['owner'])
        audio_ids = list(queryset.order_by('-downloaded_date').values_list('id', flat=True)[:options['limit']])

        run_mode = 'sync' if options['sync'] else 'enqueue'
        self.stdout.write(f"Processing features for {len(audio_ids)} track(s) ({run_mode})...")
        for audio_id in audio_ids:
            if options['sync']:
                self.stdout.write(f"  {audio_id}: {extract_features_task(audio_id)}")
            else:
                extract_features_task.delay(audio_id)

        verb = 'processed' if options['sync'] else 'enqueued'
        self.stdout.write(self.style.SUCCESS(f"Done. {len(audio_ids)} track(s) {verb}."))
