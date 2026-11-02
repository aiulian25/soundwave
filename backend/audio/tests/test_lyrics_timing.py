"""FEAT-010: saving new lyric timing, with the words protected and concurrent edits refused.

Run: python manage.py test audio.tests.test_lyrics_timing --settings=config.settings_test
"""
import threading

from django.db import connection, connections
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient
from unittest import skipUnless

from audio.lrc import parse_lrc
from audio.lyrics_timing import save_lyrics_timing, LyricsChanged
from audio.models import Audio
from audio.models_lyrics import Lyrics
from audio.tag_writer import parse_lrc_to_synced_lyrics
from user.models import Account

SYNCED = '[00:10.00]First line\n[00:20.00]Second line'
RETIMED = '[00:11.000]First line\n[00:21.000]Second line'
TRACK_SECONDS = 60


def _track(owner, youtube_id='timingTrack'):
    return Audio.objects.create(
        owner=owner, youtube_id=youtube_id, title='Song', channel_id='c', channel_name='Channel',
        duration=TRACK_SECONDS, file_path='song.m4a', file_size=1, published_date=timezone.now(),
    )


class SaveTimingTests(TestCase):
    def setUp(self):
        self.owner = Account.objects.create_user('timing_u', 'timing@test.local', 'Timingpw_2026!')
        self.audio = _track(self.owner)
        self.lyrics = Lyrics.objects.create(audio=self.audio, synced_lyrics=SYNCED, plain_lyrics='keep me', source='lrclib')
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.url = f'/api/audio/{self.audio.youtube_id}/lyrics/timing/'

    def _save(self, synced_lyrics=RETIMED, base_revision=None):
        return self.client.post(self.url, {
            'synced_lyrics': synced_lyrics,
            'base_revision': base_revision or Lyrics.objects.get(pk=self.lyrics.pk).revision,
        }, format='json')

    def _stored(self):
        return Lyrics.objects.get(pk=self.lyrics.pk)

    def test_saved_timing_is_what_every_reader_then_sees(self):
        response = self._save('[00:21.000]Second line\n[00:11.000]First line')

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['synced_lyrics'], RETIMED)
        self.assertEqual(response.data['revision'], self._stored().revision)
        self.assertEqual(self._stored().plain_lyrics, 'keep me')
        self.assertEqual(self._stored().source, 'manual')

        expected_times = [(event.text, event.time_ms) for event in parse_lrc(RETIMED)]
        download = self.client.get(f'/api/audio/{self.audio.youtube_id}/lyrics/download/?type=lrc')
        self.assertEqual(
            [(event.text, event.time_ms) for event in parse_lrc(download.content.decode())], expected_times,
        )
        self.assertEqual(parse_lrc_to_synced_lyrics(self._stored().synced_lyrics), expected_times)

    def test_the_first_timing_is_kept_through_later_edits(self):
        self._save()
        self._save('[00:12.000]First line\n[00:22.000]Second line')

        self.assertEqual(self._stored().original_synced_lyrics, SYNCED)

    def test_an_offset_tag_is_resolved_into_the_times_without_moving_them(self):
        Lyrics.objects.filter(pk=self.lyrics.pk).update(synced_lyrics=f'[offset:+500]\n{SYNCED}')

        self._save('[00:09.500]First line\n[00:19.500]Second line')

        self.assertEqual(self._stored().synced_lyrics, '[00:09.500]First line\n[00:19.500]Second line')
        self.assertEqual(self._stored().original_synced_lyrics, f'[offset:+500]\n{SYNCED}')

    def test_different_words_after_replacement_start_a_new_original(self):
        self._save()
        replacement = '[00:01.00]New words'
        Lyrics.objects.filter(pk=self.lyrics.pk).update(synced_lyrics=replacement)

        self._save('[00:02.000]New words')

        self.assertEqual(self._stored().original_synced_lyrics, replacement)

    def test_a_change_elsewhere_is_a_conflict_and_nothing_is_overwritten(self):
        stale_revision = self.lyrics.revision
        elsewhere = '[00:15.00]First line\n[00:25.00]Second line'
        Lyrics.objects.filter(pk=self.lyrics.pk).update(synced_lyrics=elsewhere)

        response = self._save(base_revision=stale_revision)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.data['current']['synced_lyrics'], elsewhere)
        self.assertEqual(self._stored().synced_lyrics, elsewhere)

    def test_saving_twice_from_one_revision_conflicts(self):
        revision = self.lyrics.revision

        self.assertEqual(self._save(base_revision=revision).status_code, 200)
        self.assertEqual(self._save('[00:12.000]First line\n[00:22.000]Second line', revision).status_code, 409)

    def test_invalid_timing_is_refused_and_nothing_changes(self):
        cases = {
            'changed words': '[00:11.000]First line\n[00:21.000]Other line',
            'missing line': '[00:11.000]First line',
            'extra line': f'{RETIMED}\n[00:31.000]Third line',
            'no timed lines': 'First line\nSecond line',
            'past the end': f'[00:11.000]First line\n[{TRACK_SECONDS + 2}:00.000]Second line',
        }
        for label, proposed in cases.items():
            with self.subTest(label):
                self.assertEqual(self._save(proposed).status_code, 400)
                self.assertEqual(self._stored().synced_lyrics, SYNCED)

    def test_a_line_just_past_a_rounded_duration_is_allowed(self):
        response = self._save('[00:11.000]First line\n[01:00.900]Second line')

        self.assertEqual(response.status_code, 200, response.content)

    def test_plain_only_lyrics_have_no_timing_to_adjust(self):
        Lyrics.objects.filter(pk=self.lyrics.pk).update(synced_lyrics='')

        self.assertEqual(self._save().status_code, 400)

    def test_another_owner_cannot_read_or_change_it(self):
        other = Account.objects.create_user('timing_other', 'other@test.local', 'Timingpw_2026!')
        client = APIClient()
        client.force_authenticate(other)

        response = client.post(self.url, {'synced_lyrics': RETIMED, 'base_revision': self.lyrics.revision}, format='json')

        self.assertEqual(response.status_code, 404)
        self.assertEqual(self._stored().synced_lyrics, SYNCED)

    def test_two_owners_of_one_video_edit_separately(self):
        other = Account.objects.create_user('timing_same', 'same@test.local', 'Timingpw_2026!')
        other_audio = _track(other)
        other_lyrics = Lyrics.objects.create(audio=other_audio, synced_lyrics=SYNCED)

        self._save()

        self.assertEqual(Lyrics.objects.get(pk=other_lyrics.pk).synced_lyrics, SYNCED)

    def test_reads_carry_what_the_editor_needs(self):
        self._save()

        response = self.client.get(f'/api/audio/{self.audio.youtube_id}/lyrics/')

        self.assertEqual(response.data['revision'], self._stored().revision)
        self.assertEqual(response.data['original_synced_lyrics'], SYNCED)


@skipUnless(connection.vendor == 'postgresql', 'SQLite has no row locks to race on')
class ConcurrentSaveTests(TransactionTestCase):
    def test_only_one_of_two_simultaneous_saves_wins(self):
        owner = Account.objects.create_user('race_u', 'race@test.local', 'Timingpw_2026!')
        audio = _track(owner, 'raceTrack')
        revision = Lyrics.objects.create(audio=audio, synced_lyrics=SYNCED).revision
        start_together = threading.Barrier(2)
        outcomes = []

        def save(proposed):
            start_together.wait()
            try:
                save_lyrics_timing(audio, proposed, revision)
                outcomes.append('saved')
            except LyricsChanged:
                outcomes.append('conflict')
            finally:
                connections.close_all()

        threads = [
            threading.Thread(target=save, args=(RETIMED,)),
            threading.Thread(target=save, args=('[00:12.000]First line\n[00:22.000]Second line',)),
        ]
        [thread.start() for thread in threads]
        [thread.join() for thread in threads]

        self.assertEqual(sorted(outcomes), ['conflict', 'saved'])
