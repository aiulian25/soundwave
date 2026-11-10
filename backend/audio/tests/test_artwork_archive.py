"""Downloaded tracks keep their artwork on this server: fetched once, then never asked for again.

Run: python manage.py test audio.tests.test_artwork_archive --settings=config.settings_test
"""
import io
import shutil
import tempfile
from io import StringIO
from pathlib import Path
from unittest import mock

import requests
from django.core.cache import cache
from django.core.management import call_command
from django.db import transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from audio.artwork_archive import CHANNEL, PLAYLIST, TRACK, archive_artwork, archive_track_artwork, stored_artwork
from audio.export import _fetch_cover_art
from audio.models import Audio
from audio.models_artwork import Artwork
from channel.models import Channel
from playlist.models import Playlist, PlaylistItem
from audio.tasks_artwork import archive_missing_artwork, archive_artwork_task
from common.safe_http import FetchedResponse, FetchRefused, REFUSED_UPSTREAM_STATUS
from user.models import Account

FETCH = 'audio.artwork_archive.fetch_public_url'
ARCHIVE_TASK_DELAY = 'audio.tasks_artwork.archive_artwork_task.delay'
NO_PAUSE = mock.patch('audio.tasks_artwork.ARCHIVE_PAUSE_SECONDS', 0)
THUMBNAIL_LINK = 'https://i.ytimg.com/vi/KEEP_ART_01/hqdefault.jpg'
COVER_LINK = 'https://coverartarchive.org/release/abc/front-250'
PLAYLIST_LINK = 'https://i.ytimg.com/vi/PLAYLIST_ART/hqdefault.jpg'
CHANNEL_LINK = 'https://yt3.googleusercontent.com/channel-picture=s176'
OTHER_HOSTS = ('ytimg', 'googleusercontent', 'ggpht')
PASSWORD = 'Keepart_2026!'
NOT_FOUND = 404
SERVICE_UNAVAILABLE = 503


def _image_bytes(colour, image_format='JPEG'):
    buffer = io.BytesIO()
    Image.new('RGB', (4, 4), colour).save(buffer, format=image_format)
    return buffer.getvalue()


THUMBNAIL_IMAGE = _image_bytes('red')
COVER_IMAGE = _image_bytes('blue', 'PNG')


def _served(image_data):
    return FetchedResponse(image_data, 'image/jpeg')


def _gone():
    return FetchRefused(REFUSED_UPSTREAM_STATUS, NOT_FOUND)


class ArchiveCase(TestCase):
    def setUp(self):
        media_root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, media_root)
        override = override_settings(MEDIA_ROOT=str(media_root))
        override.enable()
        self.addCleanup(override.disable)
        self.media_root = media_root
        cache.clear()
        self.addCleanup(cache.clear)
        # Stands in for the worker: what a page queues has run by the time the page reads what is kept.
        worker = mock.patch(ARCHIVE_TASK_DELAY, side_effect=archive_artwork_task)
        self.archive_delay = worker.start()
        self.addCleanup(worker.stop)
        self.owner = Account.objects.create_user('keep_art', 'keep_art@test.local', PASSWORD)
        self.audio = self._track('KEEP_ART_01')
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def _track(self, youtube_id, **fields):
        return Audio.objects.create(
            owner=self.owner, youtube_id=youtube_id, title='Track', channel_id='UC_keep',
            channel_name='Channel', duration=60, file_path=f'users/{self.owner.id}/{youtube_id}.m4a',
            file_size=1, published_date=timezone.now(), thumbnail_url=THUMBNAIL_LINK, **fields,
        )

    def _artwork_response(self, audio=None):
        return self.client.get(f'/api/audio/{(audio or self.audio).youtube_id}/artwork/')


class KeptOnceTests(ArchiveCase):
    def test_a_page_asks_a_worker_and_never_fetches_from_another_host_itself(self):
        """A slow host must not hold a web thread (SW-114)."""
        with mock.patch(ARCHIVE_TASK_DELAY) as queued, mock.patch(FETCH) as fetch:
            response = self._artwork_response()

        self.assertEqual(response.status_code, 404)
        fetch.assert_not_called()
        queued.assert_called_once_with(TRACK, self.audio.id)

    def test_a_failing_host_is_asked_once_an_hour_not_by_every_page_view(self):
        with mock.patch(FETCH, side_effect=requests.ConnectionError('synthetic')) as fetch:
            for _page_view in range(3):
                self.assertEqual(self._artwork_response().status_code, 404)

        self.assertEqual(self.archive_delay.call_count, 1)
        self.assertEqual(fetch.call_count, 1)

        cache.clear()  # the hour passes
        with mock.patch(FETCH, return_value=_served(THUMBNAIL_IMAGE)):
            self.assertEqual(self._artwork_response().status_code, 200)

    def test_nothing_is_queued_once_the_artwork_is_kept(self):
        with mock.patch(FETCH, return_value=_served(THUMBNAIL_IMAGE)):
            archive_track_artwork(self.audio)

        self.assertEqual(self._artwork_response().status_code, 200)
        self.archive_delay.assert_not_called()

    def test_artwork_is_kept_the_first_time_and_served_from_disk_after(self):
        with mock.patch(FETCH, return_value=_served(THUMBNAIL_IMAGE)) as fetch:
            first = self._artwork_response()
        with mock.patch(FETCH, side_effect=_gone()) as fetch_after_removal:
            second = self._artwork_response()

        self.assertEqual(fetch.call_count, 1)
        fetch_after_removal.assert_not_called()
        for response in (first, second):
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response['Content-Type'], 'image/jpeg')
            self.assertEqual(response.content, THUMBNAIL_IMAGE)
            self.assertTrue(response['Cache-Control'].startswith('private'))

    def test_an_image_youtube_no_longer_has_is_not_asked_for_again(self):
        with mock.patch(FETCH, side_effect=_gone()) as fetch:
            first = self._artwork_response()
            second = self._artwork_response()

        self.assertEqual((first.status_code, second.status_code), (404, 404))
        self.assertEqual(fetch.call_count, 1)

    def test_a_temporary_failure_is_tried_again_later(self):
        temporary_failures = (
            FetchRefused(REFUSED_UPSTREAM_STATUS, SERVICE_UNAVAILABLE),
            requests.ConnectionError('synthetic'),
            FetchRefused('too_large'),
        )
        for failure in temporary_failures:
            with self.subTest(failure=failure), mock.patch(FETCH, side_effect=failure):
                self.assertIsNone(archive_track_artwork(self.audio))

        with mock.patch(FETCH, return_value=_served(THUMBNAIL_IMAGE)):
            self.assertIsNotNone(archive_track_artwork(self.audio))

    def test_something_that_is_not_an_image_is_never_kept(self):
        with mock.patch(FETCH, return_value=FetchedResponse(b'<html>not an image</html>', 'text/html')):
            response = self._artwork_response()

        self.assertEqual(response.status_code, 404)
        self.assertFalse(Artwork.objects.exclude(local_path='').exists())

    def test_a_full_disk_does_not_break_the_caller(self):
        with mock.patch(FETCH, return_value=_served(THUMBNAIL_IMAGE)), \
                mock.patch('audio.artwork_archive._write_image', side_effect=OSError('No space left')):
            self.assertIsNone(archive_track_artwork(self.audio))


class CoverArtTests(ArchiveCase):
    def _fetch_by_link(self, link, *arguments):
        return _served(COVER_IMAGE if link.startswith('https://coverartarchive.org') else THUMBNAIL_IMAGE)

    def test_cover_art_is_kept_too_and_preferred_over_the_thumbnail(self):
        Audio.objects.filter(pk=self.audio.pk).update(cover_art_url=COVER_LINK)

        with mock.patch(FETCH, side_effect=self._fetch_by_link):
            response = self._artwork_response()

        self.assertEqual(response.content, COVER_IMAGE)
        self.assertEqual(response['Content-Type'], 'image/png')
        self.assertEqual(Artwork.objects.exclude(local_path='').count(), 2)

    def test_a_new_cover_link_replaces_the_kept_cover(self):
        Audio.objects.filter(pk=self.audio.pk).update(cover_art_url=COVER_LINK)
        with mock.patch(FETCH, side_effect=self._fetch_by_link):
            self._artwork_response()

        replacement = _image_bytes('green', 'PNG')
        Audio.objects.filter(pk=self.audio.pk).update(cover_art_url=f'{COVER_LINK}-new')
        with mock.patch(FETCH, return_value=FetchedResponse(replacement, 'image/png')):
            response = self._artwork_response()

        self.assertEqual(response.content, replacement)
        self.assertEqual(Artwork.objects.filter(artwork_type='audio_cover').count(), 1)


class ClientsNeverLoadTheOriginalTests(ArchiveCase):
    def test_track_lists_point_at_this_server(self):
        self._track('KEEP_ART_02', cover_art_url=COVER_LINK)

        response = self.client.get('/api/audio/list/')

        self.assertEqual(response.status_code, 200)
        self.assertNotIn('ytimg', response.content.decode())
        self.assertNotIn('coverartarchive', response.content.decode())
        tracks = {track['youtube_id']: track for track in response.json()['data']}
        self.assertEqual(tracks['KEEP_ART_01']['thumbnail_url'], '/api/audio/KEEP_ART_01/artwork/')
        self.assertEqual(tracks['KEEP_ART_01']['cover_art_url'], '')
        self.assertEqual(tracks['KEEP_ART_02']['cover_art_url'], '/api/audio/KEEP_ART_02/artwork/')

    def test_a_signed_in_browser_can_load_the_artwork(self):
        browser = APIClient()
        browser.login(username='keep_art', password=PASSWORD)

        with mock.patch(FETCH, return_value=_served(THUMBNAIL_IMAGE)):
            response = browser.get(f'/api/audio/{self.audio.youtube_id}/artwork/')

        self.assertEqual(response.status_code, 200)

    def test_exports_embed_the_kept_copy(self):
        with mock.patch(FETCH, return_value=_served(THUMBNAIL_IMAGE)):
            archive_track_artwork(self.audio)

        with mock.patch(FETCH, side_effect=_gone()) as fetch:
            embedded = _fetch_cover_art(self.audio, '')

        self.assertEqual(embedded, THUMBNAIL_IMAGE)
        fetch.assert_not_called()


class BackfillTests(ArchiveCase):
    def test_tracks_without_kept_artwork_are_filled_in_a_batch_at_a_time(self):
        for number in range(2, 5):
            self._track(f'KEEP_ART_0{number}')

        with NO_PAUSE, mock.patch(FETCH, return_value=_served(THUMBNAIL_IMAGE)) as fetch:
            archive_missing_artwork(limit=2)
            archive_missing_artwork(limit=2)

        self.assertEqual(fetch.call_count, 4)
        self.assertEqual(Artwork.objects.exclude(local_path='').count(), 4)

    def test_tracks_youtube_no_longer_has_are_not_retried(self):
        with NO_PAUSE, mock.patch(FETCH, side_effect=_gone()) as fetch:
            archive_missing_artwork()
            archive_missing_artwork()

        self.assertEqual(fetch.call_count, 1)

    def test_tracks_that_were_never_downloaded_are_left_alone(self):
        Audio.objects.filter(pk=self.audio.pk).update(file_path='')

        with NO_PAUSE, mock.patch(FETCH) as fetch:
            archive_missing_artwork()

        fetch.assert_not_called()


class PlaylistAndChannelArtworkTests(ArchiveCase):
    """Their pictures used to be loaded by the browser straight from YouTube and Google (SW-105)."""

    PLAYLIST_ARTWORK = '/api/playlist/PL_KEEP_ART/artwork/'
    CHANNEL_ARTWORK = '/api/channel/UC_KEEP_ART/artwork/'

    def setUp(self):
        super().setUp()
        self.playlist = Playlist.objects.create(
            owner=self.owner, playlist_id='PL_KEEP_ART', title='Kept', thumbnail_url=PLAYLIST_LINK,
        )
        self.channel = Channel.objects.create(
            owner=self.owner, channel_id='UC_KEEP_ART', channel_name='Kept Channel', subscribed=True,
            channel_thumbnail=CHANNEL_LINK,
        )

    def test_lists_point_at_this_server(self):
        PlaylistItem.objects.create(playlist=self.playlist, audio=self.audio, position=0)
        responses = {
            self.PLAYLIST_ARTWORK: self.client.get('/api/playlist/'),
            self.CHANNEL_ARTWORK: self.client.get('/api/channel/'),
            f'{self.PLAYLIST_ARTWORK} ': self.client.get(f'/api/playlist/containing/{self.audio.youtube_id}/'),
        }
        for artwork_address, response in responses.items():
            with self.subTest(artwork_address):
                body = response.content.decode()
                self.assertEqual(response.status_code, 200)
                self.assertIn(artwork_address.strip(), body)
                for host in OTHER_HOSTS:
                    self.assertNotIn(host, body)

    def test_an_item_without_a_picture_offers_no_address(self):
        Playlist.objects.create(owner=self.owner, playlist_id='PL_NO_ART', title='Bare', playlist_type='custom')

        playlists = {row['playlist_id']: row for row in self.client.get('/api/playlist/').json()['data']}

        self.assertEqual(playlists['PL_NO_ART']['thumbnail_url'], '')

    def test_the_picture_is_kept_by_a_worker_and_served_from_disk_after(self):
        for artwork_address in (self.PLAYLIST_ARTWORK, self.CHANNEL_ARTWORK):
            with self.subTest(artwork_address):
                with mock.patch(FETCH, return_value=_served(THUMBNAIL_IMAGE)) as fetch:
                    first = self.client.get(artwork_address)
                with mock.patch(FETCH, side_effect=_gone()) as fetch_after_removal:
                    second = self.client.get(artwork_address)

                self.assertEqual(fetch.call_count, 1)
                fetch_after_removal.assert_not_called()
                for response in (first, second):
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.content, THUMBNAIL_IMAGE)
                    self.assertTrue(response['Cache-Control'].startswith('private'))

    def test_a_page_asks_a_worker_and_never_fetches_itself(self):
        with mock.patch(ARCHIVE_TASK_DELAY) as queued, mock.patch(FETCH) as fetch:
            statuses = [self.client.get(address).status_code for address in (self.PLAYLIST_ARTWORK, self.CHANNEL_ARTWORK)]

        self.assertEqual(statuses, [404, 404])
        fetch.assert_not_called()
        self.assertEqual(
            [queued_call.args for queued_call in queued.call_args_list],
            [(PLAYLIST, self.playlist.id), (CHANNEL, self.channel.id)],
        )

    def test_only_the_owner_can_load_them(self):
        with mock.patch(FETCH, return_value=_served(THUMBNAIL_IMAGE)):
            archive_artwork(PLAYLIST, self.playlist)
            archive_artwork(CHANNEL, self.channel)
        stranger = APIClient()
        stranger.force_authenticate(Account.objects.create_user('art_stranger', 'art_stranger@test.local', PASSWORD))

        for artwork_address in (self.PLAYLIST_ARTWORK, self.CHANNEL_ARTWORK):
            with self.subTest(artwork_address):
                self.assertEqual(stranger.get(artwork_address).status_code, 404)
                self.assertIn(APIClient().get(artwork_address).status_code, (401, 403))

    def test_a_banner_from_another_source_is_not_served_as_the_channels_picture(self):
        Artwork.objects.create(
            channel=self.channel, artwork_type='artist_banner', source='fanart',
            url='https://assets.fanart.tv/banner.jpg', local_path='artwork/banner.jpg', priority=30,
        )

        with mock.patch(FETCH, side_effect=_gone()):
            response = self.client.get(self.CHANNEL_ARTWORK)

        self.assertEqual(response.status_code, 404)

    def test_the_browser_may_load_images_from_this_server_only(self):
        policy = self.client.get('/api/ping/')['Content-Security-Policy']

        image_sources = next(part for part in policy.split('; ') if part.startswith('img-src'))

        self.assertEqual(image_sources, "img-src 'self' data: blob:")


class KeptArtworkIsRemovedTests(ArchiveCase):
    """Deleting a track, playlist, channel or user left its kept images on disk for ever (SW-115)."""

    ORPHAN_COMMAND = 'remove_orphan_artwork'

    def setUp(self):
        super().setUp()
        self.playlist = Playlist.objects.create(
            owner=self.owner, playlist_id='PL_GONE_ART', title='Going', thumbnail_url=PLAYLIST_LINK,
        )
        self.channel = Channel.objects.create(
            owner=self.owner, channel_id='UC_GONE_ART', channel_name='Going', subscribed=True,
            channel_thumbnail=CHANNEL_LINK,
        )
        with mock.patch(FETCH, return_value=_served(THUMBNAIL_IMAGE)):
            archive_track_artwork(self.audio)
            archive_artwork(PLAYLIST, self.playlist)
            archive_artwork(CHANNEL, self.channel)

    def _kept_files(self):
        return sorted(path.name for path in (self.media_root / 'artwork').iterdir())

    def test_each_owner_object_takes_its_image_with_it(self):
        self.assertEqual(len(self._kept_files()), 3)

        for remaining, doomed in ((2, self.audio), (1, self.playlist), (0, self.channel)):
            with self.subTest(type(doomed).__name__), self.captureOnCommitCallbacks(execute=True):
                doomed.delete()
            self.assertEqual(len(self._kept_files()), remaining)

    def test_deleting_a_user_removes_the_images_of_everything_they_owned(self):
        admin = Account.objects.create_superuser('admin_art', 'admin_art@test.local', PASSWORD)
        admin_client = APIClient()
        admin_client.force_authenticate(admin)

        with self.captureOnCommitCallbacks(execute=True):
            response = admin_client.delete(f'/api/user/admin/users/{self.owner.pk}/')

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self._kept_files(), [])

    def test_a_replaced_cover_leaves_one_file_even_when_its_type_changes(self):
        Audio.objects.filter(pk=self.audio.pk).update(cover_art_url=COVER_LINK)
        self.audio.refresh_from_db()
        with mock.patch(FETCH, return_value=FetchedResponse(COVER_IMAGE, 'image/png')), \
                self.captureOnCommitCallbacks(execute=True):
            archive_track_artwork(self.audio)
        Audio.objects.filter(pk=self.audio.pk).update(cover_art_url=f'{COVER_LINK}-new')
        self.audio.refresh_from_db()

        with mock.patch(FETCH, return_value=_served(_image_bytes('green'))), \
                self.captureOnCommitCallbacks(execute=True):
            archive_track_artwork(self.audio)

        covers = [name for name in self._kept_files() if 'audio_cover' in name]
        self.assertEqual(covers, [f'audio_{self.audio.id}_audio_cover_cover_link.jpg'])
        self.assertEqual(self.client.get(f'/api/audio/{self.audio.youtube_id}/artwork/').content, _image_bytes('green'))

    def test_an_image_another_row_still_points_at_is_kept(self):
        shared_path = stored_artwork(TRACK, self.audio).local_path
        Artwork.objects.create(
            audio=self._track('KEEP_ART_09'), artwork_type='audio_thumbnail', source='youtube',
            url=THUMBNAIL_LINK, local_path=shared_path,
        )

        with self.captureOnCommitCallbacks(execute=True):
            self.audio.delete()

        self.assertTrue((self.media_root / shared_path).is_file())

    def test_a_deletion_that_is_rolled_back_removes_nothing(self):
        class Abort(Exception):
            pass

        with self.captureOnCommitCallbacks(execute=True):
            with self.assertRaises(Abort), transaction.atomic():
                self.audio.delete()
                raise Abort

        self.assertEqual(len(self._kept_files()), 3)

    def test_a_stored_path_outside_the_artwork_folder_is_never_deleted(self):
        outside = self.media_root / 'not-artwork.jpg'
        outside.write_bytes(THUMBNAIL_IMAGE)
        Artwork.objects.filter(audio=self.audio).update(local_path='not-artwork.jpg')

        with self.captureOnCommitCallbacks(execute=True):
            self.audio.delete()

        self.assertTrue(outside.is_file())

    def test_the_cleanup_command_lists_first_and_removes_only_unowned_files(self):
        orphan = self.media_root / 'artwork' / 'audio_999_audio_thumbnail_youtube.jpg'
        orphan.write_bytes(THUMBNAIL_IMAGE)
        listed, applied = StringIO(), StringIO()

        call_command(self.ORPHAN_COMMAND, stdout=listed)
        still_there_after_listing = orphan.is_file()
        call_command(self.ORPHAN_COMMAND, '--apply', stdout=applied)

        self.assertTrue(still_there_after_listing)
        self.assertIn('Would remove 1 file', listed.getvalue())
        self.assertIn('Removed 1 file', applied.getvalue())
        self.assertFalse(orphan.exists())
        self.assertEqual(len(self._kept_files()), 3)
