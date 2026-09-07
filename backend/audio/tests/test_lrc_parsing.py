"""LRC timestamp handling (CODE_REVIEW_REPORT Step 11).

Six copies of `\\[\\d{2}:\\d{2}\\.\\d{2,3}\\]` required a two-digit minute AND a mandatory
fractional part, so files using the equally-valid `[mm:ss]` or `[m:ss.x]` forms were
REJECTED at upload validation, and any such lines that got through were dropped at parse
time. All six now share LRC_TIMESTAMP_PATTERN.

Run: python manage.py test audio --settings=config.settings_test
"""
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase

from audio.serializers_lyrics import LRCUploadSerializer
from audio.views_lyrics import parse_lrc_content


def _lrc(*lines):
    return '\n'.join(lines)


class ParseLrcContentTests(TestCase):
    def synced(self, content):
        synced_lyrics, _plain, _language = parse_lrc_content(content)
        return synced_lyrics

    def test_keeps_canonical_timestamps(self):
        self.assertIn('alpha', self.synced(_lrc('[00:01.50]alpha')))

    def test_keeps_bare_mm_ss_lines(self):
        """Previously dropped: the fractional part was mandatory."""
        self.assertIn('alpha', self.synced(_lrc('[00:01]alpha')))

    def test_keeps_single_digit_minute_lines(self):
        self.assertIn('alpha', self.synced(_lrc('[1:01.5]alpha')))

    def test_keeps_long_mix_timestamps_past_99_minutes(self):
        self.assertIn('alpha', self.synced(_lrc('[100:00.00]alpha')))

    def test_metadata_tags_are_not_treated_as_timestamps(self):
        self.assertNotIn('Some Artist', self.synced(_lrc('[ar:Some Artist]', '[00:01]alpha')))

    def test_plain_text_has_timestamps_stripped(self):
        _synced, plain, _language = parse_lrc_content(_lrc('[00:01]alpha', '[00:02.5]beta'))
        self.assertNotIn('[', plain)
        self.assertIn('alpha', plain)
        self.assertIn('beta', plain)


class LrcUploadValidationTests(TestCase):
    """The validator rejected the whole file, with a message claiming it was malformed."""

    def _is_valid(self, body):
        """Drive the whole serializer: `validate_lrc_file` is a serializer-level hook and is
        NOT run by `fields['lrc_file'].run_validation()`."""
        upload = SimpleUploadedFile('test.lrc', body.encode('utf-8'), content_type='text/plain')
        return LRCUploadSerializer(data={'lrc_file': upload}).is_valid()

    def test_accepts_a_file_using_only_bare_mm_ss(self):
        self.assertTrue(self._is_valid(_lrc('[00:01]alpha', '[00:05]beta')))

    def test_accepts_a_file_using_single_digit_minutes(self):
        self.assertTrue(self._is_valid(_lrc('[1:01.5]alpha')))

    def test_accepts_long_mix_timestamps(self):
        self.assertTrue(self._is_valid(_lrc('[100:00.00]alpha')))

    def test_still_rejects_a_file_with_no_timestamps_at_all(self):
        self.assertFalse(self._is_valid(_lrc('alpha', 'beta')))
