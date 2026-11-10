"""F14 — library backup & restore.

Acceptance: a backup JSON round-trips into an empty account, recreating playlists +
smart-playlist rules + subscriptions and enqueuing the referenced tracks. Plus the
security invariants: owner ids in the JSON are ignored, the envelope is validated,
counts are capped, dry-run writes nothing, and it is per-user (not admin-only).

download_audio_task.delay is mocked so tests don't hit the network.
Run: python manage.py test appsettings --settings=config.settings_test
"""
from unittest import mock, skipUnless

from django.db import connection
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from user.models import Account, UserConfig
from audio.models import Audio
from playlist.models import Playlist, PlaylistItem
from playlist.models_smart import SmartPlaylist, SmartPlaylistRule
from channel.models import Channel
from download.models import DownloadQueue


def _make_audio(owner, youtube_id, title, downloaded=False, favorite=False, rating=0):
    return Audio.objects.create(
        owner=owner, youtube_id=youtube_id, title=title, channel_id='UC_c',
        channel_name='Chan', duration=100,
        file_path=(f'Chan/{youtube_id}.m4a' if downloaded else ''),
        file_size=(1000 if downloaded else 0),
        published_date=timezone.now(), is_favorite=favorite, rating=rating,
    )


class BackupRestoreTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.alice = Account.objects.create_user('alice_bk', 'alice_bk@test.local', 'Alicepw_2026!')
        cls.bob = Account.objects.create_user('bob_bk', 'bob_bk@test.local', 'Bobpw_2026!')

    def _seed_alice_library(self):
        a1 = _make_audio(self.alice, 'YT_track01', 'Track One', downloaded=True, favorite=True, rating=4)
        a2 = _make_audio(self.alice, 'YT_track02', 'Track Two', downloaded=False)
        playlist = Playlist.objects.create(owner=self.alice, playlist_id='PL_mix', title='Mix', playlist_type='youtube')
        PlaylistItem.objects.create(playlist=playlist, audio=a1, position=0)
        PlaylistItem.objects.create(playlist=playlist, audio=a2, position=1)
        smart = SmartPlaylist.objects.create(
            owner=self.alice, name='Heavy Rotation', match_mode='all', order_by='-downloaded_date',
        )
        SmartPlaylistRule.objects.create(
            smart_playlist=smart, field='play_count', operator='greater_than', value='5', order=0,
        )
        Channel.objects.create(
            owner=self.alice, channel_id='UC_sub01', channel_name='Sub Chan', subscribed=True, sync_depth=100,
        )
        config, _ = UserConfig.objects.get_or_create(user=self.alice)
        config.theme = 'blue'
        config.extra_settings = {'foo': 'bar'}
        config.save()

    def _client(self, user):
        client = APIClient()
        client.force_authenticate(user=user)
        return client

    def _backup_as_alice(self):
        resp = self._client(self.alice).post('/api/appsettings/backup/')
        self.assertEqual(resp.status_code, 200)
        return resp.json()

    def test_backup_contains_expected_sections(self):
        self._seed_alice_library()
        data = self._backup_as_alice()
        self.assertEqual(data['schema_version'], 1)
        self.assertEqual(data['app'], 'soundwave')
        self.assertEqual({p['playlist_id'] for p in data['playlists']}, {'PL_mix'})
        self.assertEqual({s['name'] for s in data['smart_playlists']}, {'Heavy Rotation'})
        self.assertEqual({c['channel_id'] for c in data['channels']}, {'UC_sub01'})
        self.assertEqual(len(data['audio']), 2)
        favorite = next(a for a in data['audio'] if a['youtube_id'] == 'YT_track01')
        self.assertTrue(favorite['is_favorite'])

    def test_round_trip_into_empty_account_recreates_and_enqueues(self):
        self._seed_alice_library()
        backup = self._backup_as_alice()
        with mock.patch('task.tasks.download_audio_task.delay') as fake_delay:
            resp = self._client(self.bob).post('/api/appsettings/restore/', backup, format='json')
        self.assertEqual(resp.status_code, 200)
        summary = resp.json()['summary']

        playlist = Playlist.objects.get(owner=self.bob, playlist_id='PL_mix')
        self.assertEqual(playlist.items.count(), 2)

        smart = SmartPlaylist.objects.get(owner=self.bob, name='Heavy Rotation')
        self.assertEqual(smart.rules.count(), 1)
        self.assertEqual(smart.rules.first().field, 'play_count')

        self.assertTrue(Channel.objects.filter(owner=self.bob, channel_id='UC_sub01', sync_depth=100).exists())
        self.assertTrue(Audio.objects.filter(owner=self.bob, youtube_id='YT_track01', is_favorite=True).exists())

        self.assertEqual(summary['downloads_enqueued'], 2)
        self.assertEqual(fake_delay.call_count, 2)
        self.assertTrue(DownloadQueue.objects.filter(owner=self.bob, youtube_id='YT_track01').exists())

        config = UserConfig.objects.get(user=self.bob)
        self.assertEqual(config.theme, 'blue')
        self.assertEqual(config.extra_settings.get('foo'), 'bar')

    def test_ratings_travel_with_the_backup_without_replacing_existing_ones(self):
        self._seed_alice_library()
        backup = self._backup_as_alice()
        self.assertEqual({entry['youtube_id']: entry['rating'] for entry in backup['audio']},
                         {'YT_track01': 4, 'YT_track02': 0})
        already_rated = _make_audio(self.bob, 'YT_track01', 'Track One', downloaded=True, rating=2)
        not_rated_yet = _make_audio(self.bob, 'YT_track02', 'Track Two', downloaded=True)
        second_track = next(entry for entry in backup['audio'] if entry['youtube_id'] == 'YT_track02')
        second_track['rating'] = 5
        backup['audio'].append({**second_track, 'youtube_id': 'YT_track03', 'rating': 99})

        with mock.patch('task.tasks.download_audio_task.delay'):
            self._client(self.bob).post('/api/appsettings/restore/', backup, format='json')

        already_rated.refresh_from_db()
        not_rated_yet.refresh_from_db()
        self.assertEqual((already_rated.rating, already_rated.is_favorite), (2, True))
        self.assertEqual(not_rated_yet.rating, 5)
        self.assertEqual(Audio.objects.get(owner=self.bob, youtube_id='YT_track03').rating, 0)

    def test_restore_is_idempotent(self):
        self._seed_alice_library()
        backup = self._backup_as_alice()
        client = self._client(self.bob)
        with mock.patch('task.tasks.download_audio_task.delay'):
            client.post('/api/appsettings/restore/', backup, format='json')
            second = client.post('/api/appsettings/restore/', backup, format='json')
        summary = second.json()['summary']
        self.assertEqual(summary['playlists_created'], 0)
        self.assertEqual(summary['smart_playlists_created'], 0)
        self.assertEqual(summary['channels_created'], 0)
        self.assertEqual(summary['audio_created'], 0)
        self.assertEqual(summary['downloads_enqueued'], 0)
        self.assertEqual(Playlist.objects.filter(owner=self.bob, playlist_id='PL_mix').count(), 1)
        self.assertEqual(SmartPlaylist.objects.filter(owner=self.bob, name='Heavy Rotation').count(), 1)

    def test_restore_ignores_owner_ids_in_json(self):
        backup = {
            'schema_version': 1, 'app': 'soundwave', 'exported_at': timezone.now().isoformat(),
            'audio': [{
                'youtube_id': 'YT_evil0001', 'title': 'X', 'owner': 9999, 'is_favorite': True,
                'duration': 1, 'published_date': timezone.now().isoformat(),
                'channel_id': '', 'channel_name': '',
            }],
            'playlists': [], 'smart_playlists': [], 'channels': [], 'user_config': {},
        }
        with mock.patch('task.tasks.download_audio_task.delay'):
            resp = self._client(self.bob).post('/api/appsettings/restore/', backup, format='json')
        self.assertEqual(resp.status_code, 200)
        created = Audio.objects.get(youtube_id='YT_evil0001')
        self.assertEqual(created.owner, self.bob)  # owner comes from request.user, not the JSON

    def test_dry_run_previews_without_writing(self):
        self._seed_alice_library()
        backup = self._backup_as_alice()
        with mock.patch('task.tasks.download_audio_task.delay') as fake_delay:
            resp = self._client(self.bob).post('/api/appsettings/restore/?dry_run=1', backup, format='json')
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertTrue(body['dry_run'])
        self.assertEqual(body['summary']['playlists_new'], 1)
        self.assertEqual(body['summary']['smart_playlists_new'], 1)
        self.assertEqual(body['summary']['channels_new'], 1)
        self.assertEqual(body['summary']['downloads_to_enqueue'], 2)
        self.assertFalse(Playlist.objects.filter(owner=self.bob).exists())
        fake_delay.assert_not_called()

    def test_wrong_schema_version_rejected(self):
        resp = self._client(self.bob).post(
            '/api/appsettings/restore/', {'schema_version': 99, 'app': 'soundwave'}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_unknown_top_level_key_rejected(self):
        resp = self._client(self.bob).post(
            '/api/appsettings/restore/', {'schema_version': 1, 'app': 'soundwave', 'evil': 1}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_over_cap_rejected(self):
        body = {'schema_version': 1, 'app': 'soundwave',
                'channels': [{'channel_id': 'a'}, {'channel_id': 'b'}]}
        with mock.patch('appsettings.backup.MAX_CHANNELS', 1):
            resp = self._client(self.bob).post('/api/appsettings/restore/', body, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_regular_non_staff_user_can_backup(self):
        self.assertFalse(self.alice.is_staff)
        resp = self._client(self.alice).post('/api/appsettings/backup/')
        self.assertEqual(resp.status_code, 200)  # AuthenticatedOwnerAccess (per-user), not AdminOnly

    def test_restore_clamps_out_of_range_sync_depth(self):
        backup = {
            'schema_version': 1, 'app': 'soundwave',
            'channels': [{'channel_id': 'UC_big001', 'channel_name': 'Big', 'subscribed': True, 'sync_depth': 999999}],
        }
        with mock.patch('task.tasks.download_audio_task.delay'):
            resp = self._client(self.bob).post('/api/appsettings/restore/', backup, format='json')
        self.assertEqual(resp.status_code, 200)
        channel = Channel.objects.get(owner=self.bob, channel_id='UC_big001')
        self.assertEqual(channel.sync_depth, 50)  # clamped from 999999 to the F6 allow-list default

    def test_restore_ignores_wrong_typed_user_config(self):
        backup = {
            'schema_version': 1, 'app': 'soundwave',
            'user_config': {'volume': 'not-an-int', 'theme': 'green'},
        }
        with mock.patch('task.tasks.download_audio_task.delay'):
            resp = self._client(self.bob).post('/api/appsettings/restore/', backup, format='json')
        self.assertEqual(resp.status_code, 200)
        config = UserConfig.objects.get(user=self.bob)
        self.assertEqual(config.theme, 'green')  # valid string applied
        self.assertIsInstance(config.volume, int)  # wrong-typed value skipped, stays a valid int

    def test_restore_keeps_smart_playlist_dropping_only_invalid_rules(self):
        backup = {
            'schema_version': 1, 'app': 'soundwave',
            'smart_playlists': [{
                'name': 'Mixed Rules', 'match_mode': 'all', 'order_by': '-downloaded_date',
                'rules': [
                    {'field': 'play_count', 'operator': 'greater_than', 'value': '3'},
                    {'field': 'bogus_field', 'operator': 'nope', 'value': 'x'},
                ],
            }],
        }
        with mock.patch('task.tasks.download_audio_task.delay'):
            resp = self._client(self.bob).post('/api/appsettings/restore/', backup, format='json')
        self.assertEqual(resp.status_code, 200)
        smart = SmartPlaylist.objects.get(owner=self.bob, name='Mixed Rules')
        self.assertEqual(smart.rules.count(), 1)  # invalid rule dropped, playlist kept
        self.assertEqual(smart.rules.first().field, 'play_count')

    def test_restore_rejects_natural_key_with_trailing_newline(self):
        backup = {
            'schema_version': 1, 'app': 'soundwave',
            'channels': [{'channel_id': 'UC_ok01\n', 'channel_name': 'X', 'subscribed': True}],
        }
        with mock.patch('task.tasks.download_audio_task.delay'):
            resp = self._client(self.bob).post('/api/appsettings/restore/', backup, format='json')
        self.assertEqual(resp.status_code, 200)
        self.assertFalse(Channel.objects.filter(owner=self.bob).exists())  # newline-suffixed key rejected


class MalformedRestoreTests(TestCase):
    """Values no export can produce get a clean refusal, with nothing half restored."""

    VALID_TRACK = {'youtube_id': 'abcdefghij1', 'title': 'Track'}

    def setUp(self):
        self.user = Account.objects.create_user('malformed_u', 'malformed@test.local', 'Malformedpw_2026!')
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _restore(self, **sections):
        envelope = {'schema_version': 1, 'app': 'soundwave', 'channels': [], 'playlists': [], 'smart_playlists': []}
        with mock.patch('task.tasks.download_audio_task.delay'):
            return self.client.post('/api/appsettings/restore/', {**envelope, **sections}, format='json')

    def _assert_refused_with_nothing_restored(self, response):
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(Audio.objects.filter(owner=self.user).count(), 0)
        self.assertEqual(Playlist.objects.filter(owner=self.user).count(), 0)

    def test_an_impossible_date_falls_back_like_any_other_unusable_date(self):
        impossible = {**self.VALID_TRACK, 'published_date': '2026-13-45T00:00:00', 'last_played': '2026-02-31T25:61:00'}

        response = self._restore(audio=[impossible])

        self.assertEqual(response.status_code, 200, response.content)
        self.assertIsNone(Audio.objects.get(owner=self.user).last_played)

    def test_out_of_range_numbers_are_refused(self):
        for field in ('year', 'duration', 'play_count'):
            with self.subTest(field):
                self._assert_refused_with_nothing_restored(
                    self._restore(audio=[self.VALID_TRACK, {'youtube_id': 'abcdefghij2', field: 10 ** 30}])
                )

    @skipUnless(connection.vendor == 'postgresql', 'SQLite stores these without complaint')
    def test_text_postgresql_cannot_store_is_refused(self):
        cases = {
            'too long': {'audio': [{**self.VALID_TRACK, 'title': 'x' * 5000}]},
            'NUL byte': {'audio': [{**self.VALID_TRACK, 'title': 'a\u0000b'}]},
            'playlist title': {'playlists': [{'playlist_id': 'PLaaaaaaaa', 'title': 't' * 5000}]},
        }
        for label, sections in cases.items():
            with self.subTest(label):
                self._assert_refused_with_nothing_restored(self._restore(**sections))
