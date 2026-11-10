"""F13 export core: quality, copy policy, tags, filename sanitization, traversal guard."""
import json
import shutil
import subprocess
import tempfile
import unittest
import zipfile
from io import BytesIO
from pathlib import Path
from unittest import mock

from django.core.cache import cache
from django.test import TestCase, override_settings
from django.utils import timezone
from mutagen.flac import FLAC
from mutagen.id3 import ID3
from mutagen.oggopus import OggOpus
from rest_framework.test import APIClient

from user.models import Account
from audio.models import Audio
from audio.export import (
    convert_audio,
    export_track_to_file,
    sanitize_export_filename,
    ExportSourceUnavailable,
    ExportedTrack,
    WARNING_ARTWORK_UNAVAILABLE,
    WARNING_TAGS_FAILED,
)
from audio.models_lyrics import Lyrics
from audio.tag_writer import write_metadata_to_file
from playlist.models import Playlist, PlaylistItem


class ConvertAudioCopyShortcutTests(TestCase):
    def test_copies_verbatim_when_source_already_target_format(self):
        with tempfile.TemporaryDirectory() as work:
            source = Path(work) / 'a.mp3'
            source.write_bytes(b'ID3-fake-mp3-bytes')
            output = Path(work) / 'out.mp3'
            result = convert_audio(source, 'mp3', 'original', output)
            self.assertEqual(result, output)
            self.assertEqual(output.read_bytes(), b'ID3-fake-mp3-bytes')  # copied, no ffmpeg


class SanitizeExportFilenameTests(TestCase):
    def test_strips_path_separators_and_unsafe_chars(self):
        self.assertEqual(sanitize_export_filename('../../etc/passwd', 'fb'), 'etcpasswd')
        self.assertEqual(sanitize_export_filename('a/b\\c:d', 'fb'), 'abcd')

    def test_falls_back_when_empty(self):
        self.assertEqual(sanitize_export_filename('   ', 'fallback'), 'fallback')
        self.assertEqual(sanitize_export_filename('', 'fallback'), 'fallback')


class ExportSourceGuardTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = Account.objects.create_user('expuser', 'exp@test.local', 'Exppw_2026!')

    def _audio(self, file_path):
        return Audio.objects.create(
            owner=self.user, youtube_id='GUARD000001', title='T',
            channel_id='UC', channel_name='C', duration=1,
            file_path=file_path, file_size=1, published_date=timezone.now(),
        )

    def test_path_traversal_file_path_is_rejected(self):
        audio = self._audio('../../../../etc/passwd')
        with self.assertRaises(ExportSourceUnavailable):
            export_track_to_file(audio, 'mp3', 'high', tempfile.mkdtemp())

    def test_missing_file_path_is_rejected(self):
        audio = self._audio('')
        with self.assertRaises(ExportSourceUnavailable):
            export_track_to_file(audio, 'mp3', 'high', tempfile.mkdtemp())


# A one-pixel PNG, enough for tag readers to see a picture.
PNG_BYTES = bytes.fromhex(
    '89504e470d0a1a0a0000000d4948445200000001000000010806000000'
    '1f15c4890000000d49444154789c6360000002000001e221bc330000000049454e44ae426082'
)
BITRATE_TOLERANCE = 0.1
FIXTURE_SECONDS = '3'


def _make_source(path):
    """Synthetic noise: silence would let an encoder use far less than the requested bitrate."""
    subprocess.run(
        ['ffmpeg', '-y', '-f', 'lavfi', '-i', f'anoisesrc=d={FIXTURE_SECONDS}:c=pink:r=44100:a=0.5',
         '-ac', '2', '-b:a', '256k', str(path)],
        check=True, capture_output=True,
    )


def _probe(path):
    output = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_name,codec_type,bit_rate',
         '-of', 'json', str(path)],
        check=True, capture_output=True, text=True,
    ).stdout
    return next(stream for stream in json.loads(output)['streams'] if stream['codec_type'] == 'audio')


@unittest.skipUnless(shutil.which('ffmpeg') and shutil.which('ffprobe'), 'needs ffmpeg')
class RealExportTests(TestCase):
    """Real encoders and tag readers on synthetic audio."""

    def setUp(self):
        media = tempfile.TemporaryDirectory()
        self.addCleanup(media.cleanup)
        settings_override = override_settings(MEDIA_ROOT=media.name)
        settings_override.enable()
        self.addCleanup(settings_override.disable)
        self.media = Path(media.name)
        self.output = Path(media.name) / 'out'
        self.output.mkdir()
        _make_source(self.media / 'source.mp3')
        self.owner = Account.objects.create_user('real_u', 'real_u@test.local', 'Realpw_2026!')
        self.audio = Audio.objects.create(
            owner=self.owner, youtube_id='REAL_1', title='Real/Track: One', channel_id='UC', channel_name='Chan',
            duration=3, file_path='source.mp3', file_size=1, published_date=timezone.now(),
        )

    def _export(self, target_format='mp3', quality='low', **options):
        with mock.patch('audio.export._fetch_cover_art', return_value=PNG_BYTES):
            return export_track_to_file(self.audio, target_format, quality, self.output, **options)

    def test_requested_bitrate_is_what_the_file_has(self):
        for quality, kilobits in (('low', 128), ('medium', 192), ('high', 320)):
            with self.subTest(quality=quality):
                stream = _probe(self._export(quality=quality).path)
                self.assertEqual(stream['codec_name'], 'mp3')
                self.assertAlmostEqual(int(stream['bit_rate']) / 1000 / kilobits, 1, delta=BITRATE_TOLERANCE)

    def test_original_keeps_the_sources_own_audio(self):
        source_bitrate = int(_probe(self.media / 'source.mp3')['bit_rate'])

        stream = _probe(self._export(quality='original').path)

        self.assertEqual(int(stream['bit_rate']), source_bitrate)

    def test_original_for_a_different_format_still_converts(self):
        _make_source(self.media / 'source.flac')
        self.audio.file_path = 'source.flac'

        self.assertEqual(_probe(self._export(quality='original').path)['codec_name'], 'mp3')

    def test_a_library_file_in_opus_takes_tags_and_exports(self):
        """Downloads kept in their original codec are usually Opus (SW-112)."""
        _make_source(self.media / 'source.opus')
        self.audio.file_path = 'source.opus'

        tagged = write_metadata_to_file('source.opus', title='Kept As Is', artist='Someone')
        exported = self._export()

        self.assertTrue(tagged)
        self.assertEqual(OggOpus(self.media / 'source.opus')['title'], ['Kept As Is'])
        self.assertEqual(_probe(self.media / 'source.opus')['codec_name'], 'opus')
        self.assertEqual(_probe(exported.path)['codec_name'], 'mp3')

    def test_flac_codec_and_tags_read_back(self):
        Lyrics.objects.create(audio=self.audio, plain_lyrics='words', synced_lyrics='[00:01.00]words')

        exported = self._export('flac')

        self.assertEqual(_probe(exported.path)['codec_name'], 'flac')
        tags = FLAC(exported.path)
        self.assertEqual(tags['title'], ['Real/Track: One'])
        self.assertEqual(len(tags.pictures), 1)
        self.assertEqual(exported.warnings, ())

    def test_artwork_and_lyric_timing_read_back_from_the_mp3(self):
        Lyrics.objects.create(
            audio=self.audio, plain_lyrics='chorus',
            synced_lyrics='[offset:+500]\n[00:10.00][00:30.5]chorus\n[1:00]last',
        )

        exported = self._export()

        tags = ID3(exported.path)
        self.assertEqual(tags.getall('APIC')[0].data, PNG_BYTES)
        self.assertEqual(tags.getall('SYLT')[0].text, [('chorus', 9500), ('chorus', 30000), ('last', 59500)])
        self.assertEqual(tags.getall('USLT')[0].text, 'chorus')
        self.assertEqual(exported.warnings, ())

    def test_file_name_cannot_carry_a_path(self):
        exported = self._export()

        self.assertEqual(exported.path.parent, self.output)
        self.assertEqual(exported.path.name, 'RealTrack One.mp3')

    def test_failed_tag_write_is_reported(self):
        with mock.patch('audio.tag_writer.write_metadata_to_file', return_value=False):
            exported = self._export()

        self.assertEqual(exported.warnings, (WARNING_TAGS_FAILED,))
        self.assertTrue(exported.path.exists())

    def test_artwork_that_could_not_be_fetched_is_reported(self):
        self.audio.thumbnail_url = 'https://i.ytimg.com/vi/x/hq.jpg'
        with mock.patch('audio.export._fetch_cover_art', return_value=None):
            exported = export_track_to_file(self.audio, 'mp3', 'low', self.output)

        self.assertEqual(exported.warnings, (WARNING_ARTWORK_UNAVAILABLE,))

    def test_no_artwork_to_embed_is_not_a_warning(self):
        with mock.patch('audio.export._fetch_cover_art', return_value=None):
            exported = export_track_to_file(self.audio, 'mp3', 'low', self.output)

        self.assertEqual(exported.warnings, ())

    def test_artwork_not_requested_is_not_a_warning(self):
        self.audio.thumbnail_url = 'https://i.ytimg.com/vi/x/hq.jpg'

        exported = self._export(embed_artwork=False)

        self.assertEqual(exported.warnings, ())


class ExportApiTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        media = tempfile.TemporaryDirectory()
        self.addCleanup(media.cleanup)
        settings_override = override_settings(MEDIA_ROOT=media.name)
        settings_override.enable()
        self.addCleanup(settings_override.disable)
        Path(media.name, 'x.mp3').write_bytes(b'audio')
        self.owner = Account.objects.create_user('api_u', 'api_u@test.local', 'Apipw_2026!')
        self.audio = Audio.objects.create(
            owner=self.owner, youtube_id='API_1', title='Api Track', channel_id='UC', channel_name='Chan',
            duration=3, file_path='x.mp3', file_size=1, published_date=timezone.now(),
        )
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.url = f'/api/audio/{self.audio.youtube_id}/export/'

    def _fake_export(self, warnings=()):
        def write(audio, target_format, quality, output_dir, **options):
            written = Path(output_dir) / f'{audio.youtube_id}.{target_format}'
            written.write_bytes(b'exported')
            self.requested = {'quality': quality, **options}
            return ExportedTrack(written, warnings)
        return write

    def test_options_are_readable_json(self):
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)['youtube_id'], 'API_1')

    def test_invalid_options_are_refused_with_a_readable_reason(self):
        for body in ({'format': 'wav'}, {'quality': 'ultra'}, {'embed_lyrics': 'perhaps'}):
            with self.subTest(body=body):
                response = self.client.post(self.url, body, format='json')
                self.assertEqual(response.status_code, 400)
                self.assertIn('error', json.loads(response.content))

    def test_false_as_text_means_false(self):
        with mock.patch('audio.export.export_track_to_file', side_effect=self._fake_export()):
            self.client.post(self.url, {'embed_lyrics': 'false', 'format': 'MP3', 'quality': 'low'}, format='json')

        self.assertFalse(self.requested['embed_lyrics'])
        self.assertEqual(self.requested['quality'], 'low')

    def test_warnings_reach_the_response(self):
        fake = self._fake_export((WARNING_ARTWORK_UNAVAILABLE, WARNING_TAGS_FAILED))
        with mock.patch('audio.export.export_track_to_file', side_effect=fake):
            response = self.client.post(self.url, {'format': 'mp3'}, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['X-Export-Warnings'], 'artwork_unavailable,tags_failed')
        self.assertEqual(b''.join(response.streaming_content), b'exported')

    def test_no_warning_header_on_a_clean_export(self):
        with mock.patch('audio.export.export_track_to_file', side_effect=self._fake_export()):
            response = self.client.post(self.url, {'format': 'mp3'}, format='json')

        self.assertNotIn('X-Export-Warnings', response)


class PlaylistExportSummaryTests(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        self.owner = Account.objects.create_user('zip_u', 'zip_u@test.local', 'Zippw_2026!')
        self.playlist = Playlist.objects.create(owner=self.owner, playlist_id='PLzip', title='Zip')
        for position, name in enumerate(('good', 'warned', 'broken')):
            audio = Audio.objects.create(
                owner=self.owner, youtube_id=name, title=name, channel_id='UC', channel_name='Chan',
                duration=3, file_path=f'{name}.mp3', file_size=1, published_date=timezone.now(),
            )
            PlaylistItem.objects.create(playlist=self.playlist, audio=audio, position=position)
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def _export(self):
        def fake(audio, target_format, quality, output_dir, *, filename, **options):
            if audio.youtube_id == 'broken':
                raise ExportSourceUnavailable('gone')
            written = Path(output_dir) / filename
            written.write_bytes(b'audio')
            warnings = (WARNING_TAGS_FAILED,) if audio.youtube_id == 'warned' else ()
            return ExportedTrack(written, warnings)

        with mock.patch('audio.export.export_track_to_file', side_effect=fake):
            return self.client.post(f'/api/playlist/{self.playlist.playlist_id}/export/', {}, format='json')

    def test_partial_export_is_distinguishable_from_a_full_one(self):
        response = self._export()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['X-Export-Omitted'], '1')
        self.assertEqual(response['X-Export-Warned'], '1')
        with zipfile.ZipFile(BytesIO(b''.join(response.streaming_content))) as archive:
            self.assertEqual(
                sorted(archive.namelist()), ['export-summary.json', 'good.mp3', 'warned.mp3'],
            )
            summary = json.loads(archive.read('export-summary.json'))
        self.assertEqual(summary['omitted'], [{'title': 'broken', 'reason': 'ExportSourceUnavailable'}])
        self.assertEqual(summary['warnings'], [{'file': 'warned.mp3', 'warnings': ['tags_failed']}])

    def test_full_export_has_no_summary(self):
        PlaylistItem.objects.filter(audio__youtube_id__in=['broken', 'warned']).delete()

        response = self._export()

        self.assertEqual(response['X-Export-Omitted'], '0')
        self.assertEqual(response['X-Export-Warned'], '0')
        with zipfile.ZipFile(BytesIO(b''.join(response.streaming_content))) as archive:
            self.assertEqual(archive.namelist(), ['good.mp3'])

    def test_invalid_options_are_refused(self):
        response = self.client.post(f'/api/playlist/{self.playlist.playlist_id}/export/', {'quality': 'ultra'}, format='json')

        self.assertEqual(response.status_code, 400)
