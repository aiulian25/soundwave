"""SW-017: upload, tag writing and the player mean the same thing by the same LRC text.

The cases live in a fixture so frontend/src/utils/lrc.test.ts runs the very same ones.
Run: python manage.py test audio.tests.test_lrc_parsing --settings=config.settings_test
"""
import json
from pathlib import Path

from django.test import SimpleTestCase

from audio.lrc import LyricEvent, format_lrc, parse_lrc, text_without_timing
from audio.tag_writer import parse_lrc_to_synced_lyrics
from audio.views_lyrics import parse_lrc_content

CONTRACT = json.loads((Path(__file__).parent / 'fixtures' / 'lrc_contract.json').read_text(encoding='utf-8'))


class LrcContractTests(SimpleTestCase):
    def test_every_case(self):
        for case in CONTRACT:
            with self.subTest(case['name']):
                self.assertEqual([list(event) for event in parse_lrc(case['lrc'])], case['events'])

    def test_tag_writer_uses_the_same_times(self):
        for case in CONTRACT:
            with self.subTest(case['name']):
                expected = [(text, time_ms) for time_ms, text in case['events']]
                self.assertEqual(parse_lrc_to_synced_lyrics(case['lrc']), expected)


class UploadTests(SimpleTestCase):
    def test_upload_keeps_what_later_parsers_need(self):
        source = '[ar:Someone]\n[offset:+500]\n[00:10.00][00:30.00]chorus\n[00:20.00]verse'

        synced, plain, _language = parse_lrc_content(source)

        self.assertEqual(parse_lrc(synced), parse_lrc(source))
        self.assertEqual(plain, 'chorus\nverse')
        self.assertNotIn('[ar:', synced)

    def test_upload_without_an_offset_adds_nothing(self):
        synced, _plain, _language = parse_lrc_content('[00:10.00]alpha')

        self.assertEqual(synced, '[00:10.00]alpha')

    def test_plain_download_shows_no_timing(self):
        self.assertEqual(
            text_without_timing('[offset:+500]\n[00:10.00][00:30.00]chorus').strip(),
            'chorus',
        )


class CanonicalFormTests(SimpleTestCase):
    def test_writes_the_form_the_frontend_also_writes(self):
        events = [LyricEvent(62505, 'alpha'), LyricEvent(6000000, 'beta')]

        self.assertEqual(format_lrc(events), '[01:02.505]alpha\n[100:00.000]beta')

    def test_every_contract_case_keeps_its_times_through_a_round_trip(self):
        for case in CONTRACT:
            with self.subTest(case['name']):
                events = parse_lrc(case['lrc'])
                self.assertEqual(parse_lrc(format_lrc(events)), events)
