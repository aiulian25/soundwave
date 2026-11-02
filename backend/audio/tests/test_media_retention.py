"""SW-002: physical paths are shared between owners of the same video, so one owner's
delete must leave bytes another row references, and bytes only go after the commit.

Run: python manage.py test audio.tests.test_media_retention --settings=config.settings_test
"""
import shutil
import tempfile
from pathlib import Path

from django.db import transaction
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from audio.models import Audio
from user.models import Account

SHARED_PATH = 'Channel/shared-YT_SHARED_01.m4a'
PRIVATE_PATH = 'Channel/private-YT_PRIVATE1.m4a'
FILE_CONTENT = b'synthetic audio bytes'


def make_audio(owner, youtube_id, file_path):
    return Audio.objects.create(
        owner=owner,
        youtube_id=youtube_id,
        title=youtube_id,
        channel_id='UC_retention',
        channel_name='Channel',
        duration=1,
        file_path=file_path,
        file_size=1,
        published_date=timezone.now(),
    )


class MediaRetentionTests(TestCase):
    def setUp(self):
        self.media_root = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, self.media_root)
        settings_override = override_settings(MEDIA_ROOT=str(self.media_root))
        settings_override.enable()
        self.addCleanup(settings_override.disable)

        (self.media_root / 'Channel').mkdir()
        self.shared_file = self.media_root / SHARED_PATH
        self.private_file = self.media_root / PRIVATE_PATH
        self.shared_file.write_bytes(FILE_CONTENT)
        self.private_file.write_bytes(FILE_CONTENT)

        self.alice = Account.objects.create_user('alice_ret', 'alice_ret@test.local', 'Alicepw_2026!')
        self.bob = Account.objects.create_user('bob_ret', 'bob_ret@test.local', 'Bobpw_2026!')
        self.alice_shared = make_audio(self.alice, 'YT_SHARED_01', SHARED_PATH)
        self.bob_shared = make_audio(self.bob, 'YT_SHARED_01', SHARED_PATH)
        self.alice_private = make_audio(self.alice, 'YT_PRIVATE1', PRIVATE_PATH)

    def _delete_track(self, owner, youtube_id):
        client = APIClient()
        client.force_authenticate(owner)
        with self.captureOnCommitCallbacks(execute=True):
            return client.delete(f'/api/audio/{youtube_id}/')

    def test_shared_bytes_stay_readable_for_the_other_owner(self):
        self.assertEqual(self._delete_track(self.alice, 'YT_SHARED_01').status_code, 204)
        self.assertEqual(self.shared_file.read_bytes(), FILE_CONTENT)
        self.assertTrue(Audio.objects.filter(pk=self.bob_shared.pk).exists())

    def test_last_reference_removes_the_file(self):
        self._delete_track(self.alice, 'YT_SHARED_01')
        self._delete_track(self.bob, 'YT_SHARED_01')
        self.assertFalse(self.shared_file.exists())

    def test_sole_owner_delete_removes_the_file(self):
        self._delete_track(self.alice, 'YT_PRIVATE1')
        self.assertFalse(self.private_file.exists())

    def test_already_missing_file_is_not_an_error(self):
        self.private_file.unlink()
        self.assertEqual(self._delete_track(self.alice, 'YT_PRIVATE1').status_code, 204)

    def test_rollback_keeps_row_and_bytes(self):
        class Abort(Exception):
            pass

        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            with self.assertRaises(Abort), transaction.atomic():
                self.alice_private.delete()
                raise Abort
        self.assertEqual(callbacks, [])
        self.assertTrue(self.private_file.exists())
        self.assertTrue(Audio.objects.filter(youtube_id='YT_PRIVATE1').exists())

    def test_admin_user_delete_leaves_other_owners_bytes(self):
        admin = Account.objects.create_superuser('admin_ret', 'admin_ret@test.local', 'Adminpw_2026!')
        client = APIClient()
        client.force_authenticate(admin)
        response = client.delete(f'/api/user/admin/users/{self.alice.pk}/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['files_deleted'], 1)
        self.assertEqual(self.shared_file.read_bytes(), FILE_CONTENT)
        self.assertFalse(self.private_file.exists())
        self.assertTrue(Audio.objects.filter(pk=self.bob_shared.pk).exists())
