"""F4 — YouTube captions as a synced-lyrics fallback.

Covers the network-free pieces deterministically:
  - the json3 / WebVTT -> LRC converters,
  - subtitle-track language selection,
  - the SSRF host allow-list on the subtitle URL,
  - the fetch_and_store_lyrics wiring: captions are used ONLY when LRCLIB misses,
    stored with source='captions', and an LRCLIB hit is left untouched.

The live fetch_captions_lrc('<known id>') path needs network + a captioned video and
is not run here; it is exercised manually. Run:
  python manage.py test audio.tests.test_captions_fallback --settings=config.settings_test
"""
from unittest import mock

from django.test import TestCase
from django.utils import timezone

from user.models import Account
from audio.models import Audio
from audio.models_lyrics import Lyrics
from audio import captions_service
from audio.lyrics_service import LyricsService


def _make_audio(owner, youtube_id, title):
    return Audio.objects.create(
        owner=owner,
        youtube_id=youtube_id,
        title=title,
        channel_id='UC_test',
        channel_name='Test Channel',
        duration=180,
        file_path=f'Test Channel/{title}-{youtube_id}.m4a',
        file_size=1024,
        published_date=timezone.now(),
    )


class CaptionConverterTests(TestCase):
    def test_json3_to_lrc(self):
        data = {'events': [
            {'tStartMs': 0, 'segs': [{'utf8': 'Hello'}]},
            {'tStartMs': 2500, 'segs': [{'utf8': 'world'}, {'utf8': ' now'}]},
            {'tStartMs': 5000, 'segs': [{'utf8': '\n'}]},          # blank -> skipped
            {'tStartMs': 65500, 'segs': [{'utf8': 'later'}]},
        ]}
        lrc = captions_service._json3_to_lrc(data)
        self.assertEqual(
            lrc,
            '[00:00.00]Hello\n[00:02.50]world now\n[01:05.50]later',
        )

    def test_json3_skips_events_without_start(self):
        data = {'events': [{'segs': [{'utf8': 'no time'}]}]}
        self.assertEqual(captions_service._json3_to_lrc(data), '')

    def test_vtt_to_lrc(self):
        vtt = (
            'WEBVTT\n\n'
            '00:00:01.000 --> 00:00:03.000\nFirst line\n\n'
            '00:00:04.500 --> 00:00:06.000\nSecond <c>line</c> here\n'
        )
        lrc = captions_service._vtt_to_lrc(vtt)
        self.assertEqual(
            lrc,
            '[00:01.00]First line\n[00:04.50]Second line here',
        )

    def test_pick_track_prefers_exact_then_prefix(self):
        exact = {'en': ['EN'], 'en-US': ['ENUS'], 'fr': ['FR']}
        self.assertEqual(captions_service._pick_track(exact, ['en']), ['EN'])

        prefix_only = {'en-US': ['ENUS'], 'fr': ['FR']}
        self.assertEqual(captions_service._pick_track(prefix_only, ['en']), ['ENUS'])

        self.assertIsNone(captions_service._pick_track({}, ['en']))

    def test_trusted_caption_url_allowlist(self):
        allowed = [
            'https://www.youtube.com/api/timedtext?v=x&lang=en',
            'https://youtube.com/api/timedtext',
            'https://rr3---sn-abc.googlevideo.com/timedtext',
        ]
        blocked = [
            'https://evil.com/steal',
            'http://169.254.169.254/latest/meta-data/',
            'https://youtube.com.evil.com/x',
            'not-a-url',
        ]
        for url in allowed:
            self.assertTrue(captions_service._is_trusted_caption_url(url), url)
        for url in blocked:
            self.assertFalse(captions_service._is_trusted_caption_url(url), url)


class CaptionFallbackWiringTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = Account.objects.create_user('cap', 'cap@test.local', 'Cappw_2026!')

    def test_captions_used_when_lrclib_misses(self):
        audio = _make_audio(self.user, 'CAP_MISS_0001', 'No LRCLIB Match')
        svc = LyricsService()
        captions_lrc = '[00:01.00]line one\n[00:02.00]line two\n[00:03.00]line three'

        with mock.patch.object(svc, 'fetch_lyrics', return_value={'not_found': True}), \
                mock.patch('audio.captions_service.fetch_captions_lrc',
                           return_value=captions_lrc) as fake_caps:
            result = svc.fetch_and_store_lyrics(audio)

        fake_caps.assert_called_once_with('CAP_MISS_0001')
        self.assertEqual(result.source, 'captions')
        self.assertEqual(result.synced_lyrics, captions_lrc)
        self.assertTrue(result.is_synced)
        self.assertIn('line one', result.plain_lyrics)
        self.assertNotIn('[00:01.00]', result.plain_lyrics)  # timestamps stripped

        # Captions must NOT leak into the shared, metadata-keyed LRCLIB cache.
        from audio.models_lyrics import LyricsCache
        self.assertFalse(LyricsCache.objects.exists())

    def test_lrclib_hit_is_untouched_and_captions_not_called(self):
        audio = _make_audio(self.user, 'CAP_HIT_00001', 'Has LRCLIB Match')
        svc = LyricsService()
        lrclib_result = {
            'synced_lyrics': '[00:00.50]real synced line',
            'plain_lyrics': 'real synced line',
            'instrumental': False,
            'language': 'en',
            'not_found': False,
        }

        with mock.patch.object(svc, 'fetch_lyrics', return_value=lrclib_result), \
                mock.patch('audio.captions_service.fetch_captions_lrc') as fake_caps:
            result = svc.fetch_and_store_lyrics(audio)

        fake_caps.assert_not_called()
        self.assertEqual(result.source, 'lrclib')
        self.assertEqual(result.synced_lyrics, '[00:00.50]real synced line')

    def test_no_lyrics_when_both_miss(self):
        audio = _make_audio(self.user, 'CAP_NONE_0001', 'Nothing Anywhere')
        svc = LyricsService()

        with mock.patch.object(svc, 'fetch_lyrics', return_value={'not_found': True}), \
                mock.patch('audio.captions_service.fetch_captions_lrc', return_value=None):
            result = svc.fetch_and_store_lyrics(audio)

        self.assertFalse(result.has_lyrics)
        self.assertTrue(result.fetch_attempted)
