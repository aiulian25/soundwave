"""Tests for the mix auto-split feature (F3): tracklist parser + /split/ + /segments/."""

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from user.models import Account
from audio.models import Audio
from audio.models_segments import AudioSegment
from audio.tracklist_parser import parse_tracklist


def _make_audio(owner, youtube_id, title, description='', duration=600, chapters=None):
    return Audio.objects.create(
        owner=owner, youtube_id=youtube_id, title=title,
        description=description, channel_id='UC_test', channel_name='Test Channel',
        duration=duration, file_path=f'Test Channel/{title}.m4a', file_size=1024,
        published_date=timezone.now(), chapters=chapters or [],
    )


class TracklistParserTests(TestCase):
    def test_basic_tracklist(self):
        segs = parse_tracklist('0:00 A\n3:20 B\n7:10 C', 600)
        self.assertEqual(segs, [
            {'title': 'A', 'start': 0, 'end': 200},
            {'title': 'B', 'start': 200, 'end': 430},
            {'title': 'C', 'start': 430, 'end': 600},
        ])

    def test_no_tracklist_returns_empty(self):
        self.assertEqual(parse_tracklist('just a description, no times', 600), [])
        self.assertEqual(parse_tracklist('', 600), [])
        self.assertEqual(parse_tracklist('0:00 only one line', 600), [])  # < 2 -> empty

    def test_hms_and_separators(self):
        segs = parse_tracklist('0:00 - Intro\n1:07:10 Artist - Closer', 4100)
        self.assertEqual(len(segs), 2)
        self.assertEqual(segs[1]['start'], 4030)
        self.assertEqual(segs[1]['title'], 'Artist - Closer')


class SplitEndpointTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.alice = Account.objects.create_user('alice', 'alice@test.local', 'Alicepw_2026!')
        cls.bob = Account.objects.create_user('bob', 'bob@test.local', 'Bobpw_2026!')
        cls.mix = _make_audio(cls.alice, 'MIX_YT_ID0', 'Big Mix',
                              description='0:00 A\n3:20 B\n7:10 C', duration=600)
        cls.plain = _make_audio(cls.alice, 'PLAIN_YT_ID', 'No Tracklist',
                               description='Thanks for watching!', duration=600)

    def client_for(self, user):
        c = APIClient(); c.force_authenticate(user=user); return c

    def test_split_creates_segments(self):
        resp = self.client_for(self.alice).post(f'/api/audio/{self.mix.youtube_id}/split/')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(resp.data['count'], 3)
        segs = list(AudioSegment.objects.filter(audio=self.mix).order_by('order'))
        self.assertEqual([s.start_seconds for s in segs], [0, 200, 430])
        self.assertEqual([s.end_seconds for s in segs], [200, 430, 600])
        # Item 2 starts at 200 and ends (auto-advances) at 430 — the acceptance case.
        self.assertEqual((segs[1].start_seconds, segs[1].end_seconds), (200, 430))

    def test_split_is_idempotent(self):
        c = self.client_for(self.alice)
        c.post(f'/api/audio/{self.mix.youtube_id}/split/')
        c.post(f'/api/audio/{self.mix.youtube_id}/split/')
        self.assertEqual(AudioSegment.objects.filter(audio=self.mix).count(), 3)

    def test_no_tracklist_is_friendly_400_not_500(self):
        resp = self.client_for(self.alice).post(f'/api/audio/{self.plain.youtube_id}/split/')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data.get('code'), 'no_tracklist')

    def test_bob_cannot_split_alice_mix(self):
        resp = self.client_for(self.bob).post(f'/api/audio/{self.mix.youtube_id}/split/')
        self.assertEqual(resp.status_code, 404)
        self.assertFalse(AudioSegment.objects.filter(audio=self.mix).exists())

    def test_segments_listing_owner_scoped(self):
        self.client_for(self.alice).post(f'/api/audio/{self.mix.youtube_id}/split/')
        ok = self.client_for(self.alice).get(f'/api/audio/{self.mix.youtube_id}/segments/')
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(len(ok.data['segments']), 3)
        denied = self.client_for(self.bob).get(f'/api/audio/{self.mix.youtube_id}/segments/')
        self.assertEqual(denied.status_code, 404)
