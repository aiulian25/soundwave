"""Storage-quota accounting tests (CODE_REVIEW_REPORT Step 10).

The previous implementation was check-then-act on an in-memory copy:

    if user.storage_used_gb >= user.storage_quota_gb: raise
    ...
    user.storage_used_gb += file_size_gb
    user.save()                      # full-row write from a possibly stale instance

Two failure modes follow, and both are reproduced below: a concurrent increment is lost,
and unrelated fields edited concurrently are silently overwritten by the stale row.

Run: python manage.py test audio --settings=config.settings_test
"""
from types import SimpleNamespace
from unittest import mock

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.exceptions import PermissionDenied

from audio.views_local import BYTES_PER_GB, LocalAudioViewSet

User = get_user_model()


class StorageQuotaAccountingTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = User.objects.create_user('quota_u', 'quota@test.local', 'Quotapw_2026!')
        User.objects.filter(pk=cls.user.pk).update(storage_used_gb=0.0, storage_quota_gb=50)

    # --- helpers -------------------------------------------------------------
    def _view(self, user):
        """Viewset holding an in-memory user, exactly as a real request would."""
        view = LocalAudioViewSet()
        view.request = SimpleNamespace(user=user)
        return view

    def _serializer(self, gb):
        serializer = mock.Mock()
        serializer.save.return_value = SimpleNamespace(file_size=int(gb * BYTES_PER_GB))
        return serializer

    def _used(self):
        return User.objects.get(pk=self.user.pk).storage_used_gb

    def _set(self, **fields):
        User.objects.filter(pk=self.user.pk).update(**fields)

    # --- quota enforcement ---------------------------------------------------
    def test_upload_is_rejected_when_over_quota(self):
        self._set(storage_used_gb=50.0)
        serializer = self._serializer(gb=1)
        with self.assertRaises(PermissionDenied):
            self._view(User.objects.get(pk=self.user.pk)).perform_create(serializer)
        serializer.save.assert_not_called()  # no file written for a rejected upload

    def test_admin_bypasses_the_quota(self):
        self._set(storage_used_gb=50.0, is_admin=True)
        admin = User.objects.get(pk=self.user.pk)
        self._view(admin).perform_create(self._serializer(gb=1))
        self.assertAlmostEqual(self._used(), 51.0, places=3)

    # --- the races the old code lost ----------------------------------------
    def test_increment_does_not_lose_a_concurrent_increment(self):
        """Old code wrote `stale + 2`, discarding a concurrent writer's 5 GB."""
        view = self._view(User.objects.get(pk=self.user.pk))   # stale copy: used = 0.0
        self._set(storage_used_gb=5.0)                          # concurrent upload lands
        view.perform_create(self._serializer(gb=2))
        self.assertAlmostEqual(self._used(), 7.0, places=3)     # not 2.0

    def test_increment_does_not_overwrite_unrelated_concurrent_edits(self):
        """Old full-row save() rewrote every column from the stale instance."""
        view = self._view(User.objects.get(pk=self.user.pk))   # stale quota = 50
        self._set(storage_quota_gb=999)                         # admin raises the quota
        view.perform_create(self._serializer(gb=1))
        self.assertEqual(User.objects.get(pk=self.user.pk).storage_quota_gb, 999)

    # --- release on delete ---------------------------------------------------
    def test_delete_releases_quota(self):
        self._set(storage_used_gb=10.0)
        instance = mock.Mock(owner_id=self.user.pk, file_size=int(3 * BYTES_PER_GB))
        self._view(self.user).perform_destroy(instance)
        instance.delete.assert_called_once()
        self.assertAlmostEqual(self._used(), 7.0, places=3)

    def test_delete_never_drives_the_counter_negative(self):
        self._set(storage_used_gb=1.0)
        instance = mock.Mock(owner_id=self.user.pk, file_size=int(99 * BYTES_PER_GB))
        self._view(self.user).perform_destroy(instance)
        self.assertEqual(self._used(), 0.0)
