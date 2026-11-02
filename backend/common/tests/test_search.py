"""SW-019: a search is answered by the database, one bounded page at a time.

Run: python manage.py test common.tests.test_search --settings=config.settings_test
"""
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from audio.models import Audio
from channel.models import Channel
from common.pagination import PAGE_SIZE
from common.search import MAX_SEARCH_TERM_LENGTH
from playlist.models import Playlist
from playlist.views import PLAYLIST_SEARCH_LIMIT
from user.models import Account

LIBRARY_SIZE = 10_000
TRANSFER_LIMIT_BYTES = 200_000


def _track(owner, youtube_id, title='Plain', **fields):
    return Audio(
        owner=owner, youtube_id=youtube_id, title=title, channel_id='UC', channel_name=fields.pop('channel_name', 'Chan'),
        duration=60, file_path=f'{youtube_id}.m4a', file_size=1, published_date=timezone.now(), **fields,
    )


class SearchTestCase(TestCase):
    def setUp(self):
        self.owner = Account.objects.create_user('find_u', 'find_u@test.local', 'Findpw_2026!')
        self.stranger = Account.objects.create_user('find_s', 'find_s@test.local', 'Findpw_2026!')
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def _audio(self, **params):
        return self.client.get('/api/audio/list/', params)

    def _titles(self, response):
        return {row['title'] for row in response.data['data']}


class AudioSearchTests(SearchTestCase):
    def test_a_large_library_transfers_only_one_bounded_page(self):
        Audio.objects.bulk_create(
            [_track(self.owner, f'BIG_{index}', title=f'Song {index}') for index in range(LIBRARY_SIZE)],
            batch_size=1000,
        )

        response = self._audio(q='song')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], LIBRARY_SIZE)
        self.assertEqual(len(response.data['data']), PAGE_SIZE)
        self.assertEqual(response.data['next'], 2)
        self.assertLess(len(response.content), TRANSFER_LIMIT_BYTES)

    def test_query_count_does_not_grow_with_the_library(self):
        Audio.objects.bulk_create(
            [_track(self.owner, f'FEW_{index}', title=f'Song {index}') for index in range(PAGE_SIZE * 2)],
        )

        with self.assertNumQueries(2):
            self._audio(q='song')

    def test_matches_title_artist_and_channel_ignoring_case(self):
        Audio.objects.bulk_create([
            _track(self.owner, 'T', title='Northern LIGHTS'),
            _track(self.owner, 'A', title='First', artist='The Lights'),
            _track(self.owner, 'C', title='Second', channel_name='lights channel'),
            _track(self.owner, 'N', title='Other'),
        ])

        self.assertEqual(self._titles(self._audio(q='lights')), {'Northern LIGHTS', 'First', 'Second'})

    def test_never_shows_another_accounts_tracks(self):
        Audio.objects.bulk_create([
            _track(self.owner, 'MINE', title='Shared word'),
            _track(self.stranger, 'THEIRS', title='Shared word theirs'),
        ])

        response = self._audio(q='shared')

        self.assertEqual(self._titles(response), {'Shared word'})
        self.assertEqual(response.data['count'], 1)

    def test_search_keeps_other_filters(self):
        Audio.objects.bulk_create([
            _track(self.owner, 'FAV', title='Word fav', is_favorite=True),
            _track(self.owner, 'NOT', title='Word plain'),
        ])

        self.assertEqual(self._titles(self._audio(q='word', favorites='true')), {'Word fav'})

    def test_next_page_continues_the_same_search(self):
        Audio.objects.bulk_create(
            [_track(self.owner, f'P_{index}', title=f'Word {index}') for index in range(PAGE_SIZE + 1)]
            + [_track(self.owner, 'OTHER', title='Unrelated')],
        )

        second = self._audio(q='word', page=2)

        self.assertEqual(len(second.data['data']), 1)
        self.assertIsNone(second.data['next'])

    def test_blank_search_is_the_plain_list(self):
        Audio.objects.bulk_create([_track(self.owner, 'ONE'), _track(self.owner, 'TWO')])

        self.assertEqual(self._audio(q='   ').data['count'], 2)

    def test_too_long_is_refused(self):
        self.assertEqual(self._audio(q='x' * (MAX_SEARCH_TERM_LENGTH + 1)).status_code, 400)

    def test_special_characters_are_only_text(self):
        Audio.objects.bulk_create([_track(self.owner, 'ONE', title="100% rock'n'roll")])

        self.assertEqual(self._audio(q="%").data['count'], 1)
        self.assertEqual(self._audio(q="'; DROP TABLE").data['count'], 0)


class ChannelSearchTests(SearchTestCase):
    def test_filters_and_stays_owner_scoped_and_paged(self):
        for index in range(PAGE_SIZE + 1):
            Channel.objects.create(owner=self.owner, channel_id=f'UC{index}', channel_name=f'Rock {index}')
        Channel.objects.create(owner=self.owner, channel_id='UCjazz', channel_name='Jazz')
        Channel.objects.create(owner=self.stranger, channel_id='UCtheirs', channel_name='Rock theirs')

        response = self.client.get('/api/channel/', {'q': 'rock'})

        self.assertEqual(response.data['count'], PAGE_SIZE + 1)
        self.assertEqual(len(response.data['data']), PAGE_SIZE)
        self.assertEqual(response.data['next'], 2)

    def test_too_long_is_refused(self):
        self.assertEqual(self.client.get('/api/channel/', {'q': 'x' * 500}).status_code, 400)


class PlaylistSearchTests(SearchTestCase):
    def _playlist(self, owner, name, **fields):
        return Playlist.objects.create(owner=owner, playlist_id=f'PL{owner.pk}{name}', title=name, **fields)

    def test_matches_title_and_channel_and_stays_owner_scoped(self):
        self._playlist(self.owner, 'Road trip')
        self._playlist(self.owner, 'Other', channel_name='Trip Records')
        self._playlist(self.owner, 'Unrelated')
        self._playlist(self.stranger, 'Trip theirs')

        response = self.client.get('/api/playlist/', {'q': 'trip'})

        self.assertEqual(self._titles(response), {'Road trip', 'Other'})

    def test_a_search_is_bounded_but_the_full_list_is_not(self):
        for index in range(PLAYLIST_SEARCH_LIMIT + 1):
            self._playlist(self.owner, f'Mix {index}')

        self.assertEqual(len(self.client.get('/api/playlist/', {'q': 'mix'}).data['data']), PLAYLIST_SEARCH_LIMIT)
        self.assertEqual(len(self.client.get('/api/playlist/').data['data']), PLAYLIST_SEARCH_LIMIT + 1)
