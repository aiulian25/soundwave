"""SW-010: the audio list pages stably, says when to stop, and never ignores a filter.

Run: python manage.py test audio.tests.test_audio_list --settings=config.settings_test
"""
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from audio.models import Audio
from playlist.models import Playlist, PlaylistItem
from user.models import Account

LIST_URL = '/api/audio/list/'


class AudioListTests(TestCase):
    def setUp(self):
        self.alice = Account.objects.create_user('alice_list', 'alice_list@test.local', 'Alicepw_2026!')
        self.bob = Account.objects.create_user('bob_list', 'bob_list@test.local', 'Bobpw_2026!')
        self.client = APIClient()
        self.client.force_authenticate(self.alice)
        self.published = timezone.now()

    def make_audio(self, owner, youtube_id, **fields):
        return Audio.objects.create(
            owner=owner, youtube_id=youtube_id, title=youtube_id, channel_id='UC', channel_name='C', duration=1,
            file_path=f'{youtube_id}.m4a', file_size=1, published_date=self.published, **fields,
        )

    def ids_of(self, **params):
        response = self.client.get(LIST_URL, params)
        self.assertEqual(response.status_code, 200, response.content)
        return [row['youtube_id'] for row in response.json()['data']]

    def test_tracks_sharing_a_date_each_appear_exactly_once(self):
        for index in range(101):
            self.make_audio(self.alice, f'SAME_{index:03d}')
        seen = []
        page = 1
        requests = 0
        while page is not None:
            requests += 1
            self.assertLess(requests, 10, 'pagination did not terminate')
            body = self.client.get(LIST_URL, {'page': page}).json()
            seen += [row['youtube_id'] for row in body['data']]
            page = body['next']
        self.assertEqual(requests, 3)
        self.assertEqual(len(seen), 101)
        self.assertEqual(len(set(seen)), 101)
        self.assertEqual(body['count'], 101)

    def test_order_is_total_so_ties_cannot_repeat_between_pages(self):
        # Databases may order ties differently per query, so this checks the SQL itself.
        self.make_audio(self.alice, 'ORDER_TRACK')
        with CaptureQueriesContext(connection) as queries:
            self.client.get(LIST_URL)
        ordered = [query['sql'] for query in queries if 'ORDER BY' in query['sql'] and 'audio_audio' in query['sql']]
        self.assertRegex(ordered[-1], r'ORDER BY .*"published_date".*"id"')

    def test_exactly_one_full_page_says_it_is_the_last(self):
        for index in range(50):
            self.make_audio(self.alice, f'FULL_{index:03d}')
        body = self.client.get(LIST_URL).json()
        self.assertEqual((len(body['data']), body['next'], body['paginate']), (50, None, True))

    def test_other_owners_tracks_are_excluded(self):
        self.make_audio(self.bob, 'BOB_TRACK01')
        body = self.client.get(LIST_URL).json()
        self.assertEqual((body['data'], body['count']), ([], 0))

    def test_malformed_page_is_refused(self):
        self.assertEqual(self.client.get(LIST_URL, {'page': 'abc'}).status_code, 400)

    def test_playlist_filter_is_applied(self):
        inside = self.make_audio(self.alice, 'IN_PLAYLIST')
        self.make_audio(self.alice, 'NOT_IN_LIST')
        playlist = Playlist.objects.create(owner=self.alice, playlist_id='PL_mine', title='Mine')
        PlaylistItem.objects.create(playlist=playlist, audio=inside, position=0)
        self.assertEqual(self.ids_of(playlist='PL_mine'), ['IN_PLAYLIST'])
        self.assertEqual(self.ids_of(playlist='PL_unknown'), [])

    def test_playlist_filter_cannot_look_inside_another_owners_playlist(self):
        mine = self.make_audio(self.alice, 'SHARED_ID01')
        theirs = self.make_audio(self.bob, 'SHARED_ID01')
        bob_playlist = Playlist.objects.create(owner=self.bob, playlist_id='PL_shared', title='Bob')
        PlaylistItem.objects.create(playlist=bob_playlist, audio=theirs, position=0)
        alice_playlist = Playlist.objects.create(owner=self.alice, playlist_id='PL_shared', title='Alice')
        self.assertEqual(self.ids_of(playlist='PL_shared'), [])
        PlaylistItem.objects.create(playlist=alice_playlist, audio=mine, position=0)
        self.assertEqual(self.ids_of(playlist='PL_shared'), ['SHARED_ID01'])

    def test_a_track_inside_someone_elses_playlist_does_not_match(self):
        mine = self.make_audio(self.alice, 'MISFILED_01')
        bob_playlist = Playlist.objects.create(owner=self.bob, playlist_id='PL_bobs', title='Bob')
        PlaylistItem.objects.create(playlist=bob_playlist, audio=mine, position=0)
        self.assertEqual(self.ids_of(playlist='PL_bobs'), [])

    def test_status_filter_is_refused_not_ignored(self):
        self.make_audio(self.alice, 'ANY_TRACK01')
        self.assertEqual(self.client.get(LIST_URL, {'status': 'played'}).status_code, 400)

    def test_other_filters_still_work(self):
        self.make_audio(self.alice, 'FAVOURITE01', is_favorite=True)
        self.make_audio(self.alice, 'ORDINARY_01')
        self.assertEqual(self.ids_of(favorites='true'), ['FAVOURITE01'])
