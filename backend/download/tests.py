"""F15 — activity center backend surface.

The activity center reuses the existing download endpoints: the queue list (now with
filter=all for one-request grouping) and the per-item retry. These tests lock in the
filter=all extension, owner-scoping, error_message exposure, and the retry flip.

Run: python manage.py test download --settings=config.settings_test
"""
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from user.models import Account
from download.models import DownloadQueue


def _queue(owner, url, status='pending', **extra):
    return DownloadQueue.objects.create(owner=owner, url=url, status=status, **extra)


class DownloadListFilterTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.alice = Account.objects.create_user('alice_dl', 'alice_dl@test.local', 'Alicepw_2026!')
        cls.bob = Account.objects.create_user('bob_dl', 'bob_dl@test.local', 'Bobpw_2026!')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.alice)

    def test_filter_all_returns_every_status(self):
        _queue(self.alice, 'https://www.youtube.com/watch?v=a', status='pending')
        _queue(self.alice, 'https://www.youtube.com/watch?v=b', status='downloading')
        _queue(self.alice, 'https://www.youtube.com/watch?v=c', status='failed', error_message='boom')
        _queue(self.alice, 'https://www.youtube.com/watch?v=d', status='completed')
        resp = self.client.get('/api/download/?filter=all')
        self.assertEqual(resp.status_code, 200)
        statuses = sorted(row['status'] for row in resp.json()['data'])
        self.assertEqual(statuses, ['completed', 'downloading', 'failed', 'pending'])

    def test_default_filter_is_pending(self):
        _queue(self.alice, 'https://www.youtube.com/watch?v=a', status='pending')
        _queue(self.alice, 'https://www.youtube.com/watch?v=b', status='failed')
        resp = self.client.get('/api/download/')
        self.assertEqual(resp.status_code, 200)
        rows = resp.json()['data']
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['status'], 'pending')

    def test_filter_all_is_owner_scoped(self):
        _queue(self.alice, 'https://www.youtube.com/watch?v=a', status='pending')
        _queue(self.bob, 'https://www.youtube.com/watch?v=z', status='pending')
        resp = self.client.get('/api/download/?filter=all')
        urls = [row['url'] for row in resp.json()['data']]
        self.assertEqual(urls, ['https://www.youtube.com/watch?v=a'])

    def test_failed_row_exposes_error_message(self):
        _queue(self.alice, 'https://www.youtube.com/watch?v=c', status='failed', error_message='ffmpeg failed')
        resp = self.client.get('/api/download/?filter=failed')
        rows = resp.json()['data']
        self.assertEqual(rows[0]['error_message'], 'ffmpeg failed')


class RetryTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.alice = Account.objects.create_user('alice_rt', 'alice_rt@test.local', 'Alicepw_2026!')
        cls.bob = Account.objects.create_user('bob_rt', 'bob_rt@test.local', 'Bobpw_2026!')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(user=self.alice)

    def test_retry_flips_failed_to_pending_and_redispatches(self):
        item = _queue(self.alice, 'https://www.youtube.com/watch?v=x', status='failed', error_message='boom')
        with mock.patch('task.tasks.download_audio_task.delay') as fake_delay:
            resp = self.client.post('/api/download/retry/', {'id': item.id}, format='json')
        self.assertEqual(resp.status_code, 200)
        item.refresh_from_db()
        self.assertEqual(item.status, 'pending')
        fake_delay.assert_called_once_with(item.id)

    def test_retry_cross_owner_is_404(self):
        item = _queue(self.bob, 'https://www.youtube.com/watch?v=z', status='failed')
        with mock.patch('task.tasks.download_audio_task.delay') as fake_delay:
            resp = self.client.post('/api/download/retry/', {'id': item.id}, format='json')
        self.assertEqual(resp.status_code, 404)
        fake_delay.assert_not_called()
        item.refresh_from_db()
        self.assertEqual(item.status, 'failed')  # unchanged
