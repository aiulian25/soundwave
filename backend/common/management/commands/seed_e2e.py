"""Seed deterministic data for end-to-end (Playwright) tests.

Creates a fixed test user and one **playable** local track — a tiny silent WAV written
straight to MEDIA_ROOT (no YouTube/yt-dlp/ffmpeg needed), with a matching Audio row so it
shows up in the DB-backed library and streams via the normal signed-ticket path.

Idempotent. Credentials come from env (E2E_USERNAME / E2E_PASSWORD) with safe defaults.
Intended for ephemeral CI stacks — do not run against a production database.
"""

import os
import wave
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from audio.models import Audio
from user.models import Account

E2E_USERNAME = os.environ.get('E2E_USERNAME', 'e2e_user')
E2E_PASSWORD = os.environ.get('E2E_PASSWORD', 'E2e-Test_2026!')
E2E_YOUTUBE_ID = 'e2e-sample-0001'
SAMPLE_REL_PATH = 'e2e/sample.wav'


class Command(BaseCommand):
    help = 'Seed a deterministic user + one playable track for end-to-end tests.'

    def handle(self, *args, **options):
        # --- user (forced-password-change off so login goes straight through) ---
        user, _ = Account.objects.get_or_create(
            username=E2E_USERNAME,
            defaults={'email': 'e2e@example.local'},
        )
        user.set_password(E2E_PASSWORD)
        user.is_active = True
        if hasattr(user, 'password_change_required'):
            user.password_change_required = False
        user.save()

        # --- tiny silent WAV the browser can actually play ---
        media_root = Path(settings.MEDIA_ROOT)
        full = media_root / SAMPLE_REL_PATH
        full.parent.mkdir(parents=True, exist_ok=True)
        if not full.exists():
            self._write_silent_wav(full, seconds=2)

        # --- Audio row owned by the e2e user (DB-backed library + ownership check) ---
        Audio.objects.update_or_create(
            owner=user,
            youtube_id=E2E_YOUTUBE_ID,
            defaults={
                'title': 'E2E Sample Track',
                'channel_id': 'e2e-channel',
                'channel_name': 'E2E Channel',
                'duration': 2,
                'file_path': SAMPLE_REL_PATH,
                'file_size': full.stat().st_size,
                'published_date': timezone.now(),
            },
        )

        self.stdout.write(self.style.SUCCESS(
            f'Seeded e2e user "{E2E_USERNAME}" + playable track "{SAMPLE_REL_PATH}".'
        ))

    @staticmethod
    def _write_silent_wav(path: Path, seconds: int = 2, rate: int = 8000) -> None:
        with wave.open(str(path), 'w') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes(b'\x00\x00' * rate * seconds)
