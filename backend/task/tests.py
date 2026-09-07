"""Sonic feature backfill task tests (CODE_REVIEW_REPORT Step 7).

Feature extraction otherwise only fires post-download, so any library predating F16 keeps
an empty `feature_vector` forever and Sonic/Auto-DJ stay on the metadata fallback.

The guard matters as much as the backfill: `extract_features_task` returns early on
ImportError WITHOUT writing a vector, so on an image without the DSP stack every hourly
run would re-enqueue the same tracks indefinitely.

Run: python manage.py test task --settings=config.settings_test
"""
from unittest import mock

from django.test import TestCase
from django.utils import timezone

from datetime import timedelta

from audio.models import Audio
from audio.models_radio import RadioTrackFeedback
from audio.radio_features import RADIO_FEEDBACK_RETENTION_DAYS
from task.tasks import backfill_missing_features_task, prune_radio_feedback_task
from user.models import Account

BACKFILL_TASK_NAME = 'task.tasks.backfill_missing_features_task'
PRUNE_TASK_NAME = 'task.tasks.prune_radio_feedback_task'
FEATURE_VECTOR = [0.5, 0.4, 0.3, 0.2, 0.6, 0.5, 0.5]


def _make_audio(owner, youtube_id, file_path='Chan/track.m4a', feature_vector=None):
    return Audio.objects.create(
        owner=owner,
        youtube_id=youtube_id,
        title=f'Track {youtube_id}',
        channel_id='UC_backfill',
        channel_name='Backfill Chan',
        duration=180,
        file_path=file_path,
        file_size=1024,
        published_date=timezone.now(),
        feature_vector=feature_vector or [],
    )


class BackfillMissingFeaturesTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = Account.objects.create_user('bf_user', 'bf@test.local', 'Bfpw_2026!')
        cls.needs_features = _make_audio(cls.user, 'BF_NEEDS_1')
        cls.also_needs = _make_audio(cls.user, 'BF_NEEDS_2')
        cls.already_done = _make_audio(cls.user, 'BF_DONE', feature_vector=FEATURE_VECTOR)
        cls.no_file = _make_audio(cls.user, 'BF_NOFILE', file_path='')

    def run_task(self, librosa_present=True, **kwargs):
        """Run the task with librosa availability faked, capturing enqueued ids."""
        spec = object() if librosa_present else None
        with mock.patch('task.tasks.find_spec', return_value=spec), \
             mock.patch('task.tasks.extract_features_task.delay') as fake_delay:
            result = backfill_missing_features_task(**kwargs)
        enqueued = [call.args[0] for call in fake_delay.call_args_list]
        return result, enqueued

    def test_enqueues_only_tracks_missing_a_vector(self):
        _, enqueued = self.run_task()
        self.assertCountEqual(enqueued, [self.needs_features.id, self.also_needs.id])

    def test_skips_tracks_that_already_have_a_vector(self):
        _, enqueued = self.run_task()
        self.assertNotIn(self.already_done.id, enqueued)

    def test_skips_tracks_with_no_file(self):
        _, enqueued = self.run_task()
        self.assertNotIn(self.no_file.id, enqueued)

    def test_respects_the_limit(self):
        _, enqueued = self.run_task(limit=1)
        self.assertEqual(len(enqueued), 1)

    # --- the guard: no endless re-enqueue on an image without the DSP stack ---
    def test_enqueues_nothing_when_librosa_is_unavailable(self):
        result, enqueued = self.run_task(librosa_present=False)
        self.assertEqual(enqueued, [])
        self.assertIn('librosa unavailable', result)


class PruneRadioFeedbackTests(TestCase):
    """RadioTrackFeedback gains a row per skip/like and is aggregated on every next-track."""

    @classmethod
    def setUpTestData(cls):
        cls.user = Account.objects.create_user('prune_u', 'prune@test.local', 'Prunepw_2026!')

    def _feedback(self, youtube_id, age_days=0):
        row = RadioTrackFeedback.objects.create(
            user=self.user, youtube_id=youtube_id, channel_id='c', feedback_type='skipped'
        )
        if age_days:
            stale = timezone.now() - timedelta(days=age_days)
            RadioTrackFeedback.objects.filter(pk=row.pk).update(created_at=stale)
        return row

    def test_deletes_only_rows_past_the_retention_window(self):
        recent = self._feedback('KEEP_ME')
        stale = self._feedback('DROP_ME', age_days=RADIO_FEEDBACK_RETENTION_DAYS + 1)

        prune_radio_feedback_task()

        self.assertTrue(RadioTrackFeedback.objects.filter(pk=recent.pk).exists())
        self.assertFalse(RadioTrackFeedback.objects.filter(pk=stale.pk).exists())

    def test_reports_how_many_rows_were_pruned(self):
        for index in range(3):
            self._feedback(f'OLD_{index}', age_days=RADIO_FEEDBACK_RETENTION_DAYS + 5)
        self.assertIn('3', prune_radio_feedback_task())

    def test_is_a_no_op_when_nothing_is_stale(self):
        self._feedback('FRESH')
        prune_radio_feedback_task()
        self.assertEqual(RadioTrackFeedback.objects.count(), 1)


class BeatScheduleTests(TestCase):
    """A typo'd dotted path in beat_schedule fails silently at runtime -- pin it."""

    def test_backfill_is_scheduled_and_the_task_name_resolves(self):
        from config.celery import app

        entry = app.conf.beat_schedule.get('backfill-missing-sonic-features')
        self.assertIsNotNone(entry, 'backfill beat entry is missing')
        self.assertEqual(entry['task'], BACKFILL_TASK_NAME)
        self.assertIn(BACKFILL_TASK_NAME, app.tasks,
                      'beat_schedule points at a task name Celery has not registered')

    def test_prune_is_scheduled_and_the_task_name_resolves(self):
        from config.celery import app

        entry = app.conf.beat_schedule.get('prune-radio-feedback')
        self.assertIsNotNone(entry, 'prune beat entry is missing')
        self.assertEqual(entry['task'], PRUNE_TASK_NAME)
        self.assertIn(PRUNE_TASK_NAME, app.tasks,
                      'beat_schedule points at a task name Celery has not registered')
