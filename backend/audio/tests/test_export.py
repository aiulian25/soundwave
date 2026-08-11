"""F13 export core: convert_audio copy-shortcut, filename sanitization, traversal guard."""
import tempfile
from pathlib import Path

from django.test import TestCase
from django.utils import timezone

from user.models import Account
from audio.models import Audio
from audio.export import (
    convert_audio,
    export_track_to_file,
    sanitize_export_filename,
    ExportSourceUnavailable,
)


class ConvertAudioCopyShortcutTests(TestCase):
    def test_copies_verbatim_when_source_already_target_format(self):
        with tempfile.TemporaryDirectory() as work:
            source = Path(work) / 'a.mp3'
            source.write_bytes(b'ID3-fake-mp3-bytes')
            output = Path(work) / 'out.mp3'
            result = convert_audio(source, 'mp3', 'high', output)
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
