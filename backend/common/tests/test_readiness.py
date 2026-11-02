"""SW-020: liveness says the web process answers; readiness says the system works.

Run: python manage.py test common.tests.test_readiness --settings=config.settings_test
"""
import time
from io import StringIO
from unittest import mock

from django.core.cache import cache
from django.core.management import call_command
from django.db import OperationalError
from django.test import TestCase
from kombu.exceptions import OperationalError as BrokerError
from redis import ConnectionError as RedisConnectionError
from rest_framework.test import APIClient

from common.readiness import (
    HEARTBEAT_KEY,
    HEARTBEAT_STALE_SECONDS,
    readiness_report,
    record_heartbeat,
)
from common.tasks import heartbeat
from user.models import Account

MEMORY = {'used_memory': 10, 'maxmemory': 100}


class ReadinessTestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.addCleanup(cache.clear)
        redis_patch = mock.patch('common.readiness.Redis.from_url')
        self.redis = redis_patch.start().return_value
        self.addCleanup(redis_patch.stop)
        self.redis.info.return_value = MEMORY
        self.redis.llen.return_value = 3
        ping_patch = mock.patch('config.celery.app.control.ping', return_value=[{'worker@x': {'ok': 'pong'}}])
        self.worker_ping = ping_patch.start()
        self.addCleanup(ping_patch.stop)
        record_heartbeat()


class ReportTests(ReadinessTestCase):
    def test_all_working(self):
        report = readiness_report()

        self.assertTrue(report['ready'])
        self.assertEqual(report['checks']['redis']['queued_tasks'], 3)
        self.assertEqual(report['checks']['worker']['workers'], 1)

    def test_a_silent_worker_is_not_ready(self):
        self.worker_ping.return_value = []

        report = readiness_report()

        self.assertFalse(report['ready'])
        self.assertFalse(report['checks']['worker']['ok'])
        self.assertTrue(report['checks']['database']['ok'])

    def test_broker_failure_is_reported_not_raised(self):
        self.worker_ping.side_effect = BrokerError('down')

        self.assertFalse(readiness_report()['checks']['worker']['ok'])

    def test_redis_down_is_reported_not_raised(self):
        self.redis.info.side_effect = RedisConnectionError('down')

        report = readiness_report()

        self.assertFalse(report['ready'])
        self.assertEqual(report['checks']['redis']['detail'], 'ConnectionError')
        self.redis.close.assert_called_once()

    def test_redis_timeouts_are_bounded(self):
        with mock.patch('common.readiness.Redis.from_url') as from_url:
            from_url.return_value.info.return_value = MEMORY
            from_url.return_value.llen.return_value = 0
            readiness_report()

        self.assertIn('socket_timeout', from_url.call_args.kwargs)
        self.assertIn('socket_connect_timeout', from_url.call_args.kwargs)

    def test_database_down_is_reported_not_raised(self):
        with mock.patch('common.readiness.connection.cursor', side_effect=OperationalError('down')):
            report = readiness_report()

        self.assertFalse(report['ready'])
        self.assertFalse(report['checks']['database']['ok'])

    def test_a_stale_heartbeat_means_the_scheduler_stopped(self):
        cache.set(HEARTBEAT_KEY, time.time() - HEARTBEAT_STALE_SECONDS - 5)

        report = readiness_report()

        self.assertFalse(report['ready'])
        self.assertFalse(report['checks']['scheduler']['ok'])
        self.assertTrue(report['checks']['worker']['ok'])

    def test_a_recent_heartbeat_within_the_margin_is_fine(self):
        cache.set(HEARTBEAT_KEY, time.time() - HEARTBEAT_STALE_SECONDS + 30)

        self.assertTrue(readiness_report()['checks']['scheduler']['ok'])

    def test_no_heartbeat_yet_is_not_ready(self):
        cache.delete(HEARTBEAT_KEY)

        self.assertFalse(readiness_report()['checks']['scheduler']['ok'])

    def test_redis_pressure_is_visible(self):
        self.assertFalse(readiness_report()['checks']['redis']['under_pressure'])

        self.redis.info.return_value = {'used_memory': 90, 'maxmemory': 100}

        self.assertTrue(readiness_report()['checks']['redis']['under_pressure'])

    def test_no_memory_limit_is_not_pressure(self):
        self.redis.info.return_value = {'used_memory': 90, 'maxmemory': 0}

        self.assertFalse(readiness_report()['checks']['redis']['under_pressure'])

    def test_the_heartbeat_task_records_the_time(self):
        cache.delete(HEARTBEAT_KEY)

        heartbeat()

        self.assertIsNotNone(cache.get(HEARTBEAT_KEY))

    def test_the_heartbeat_is_scheduled_under_a_real_task_name(self):
        from config.celery import app

        entry = app.conf.beat_schedule['system-heartbeat']
        self.assertEqual(entry['task'], 'common.record_heartbeat')
        self.assertIn('common.record_heartbeat', app.tasks)


class EndpointTests(ReadinessTestCase):
    URL = '/api/ready/'

    def setUp(self):
        super().setUp()
        self.admin = Account.objects.create_user('ready_a', 'ready_a@test.local', 'Readypw_2026!')
        self.admin.is_staff = True
        self.admin.save()
        self.user = Account.objects.create_user('ready_u', 'ready_u@test.local', 'Readypw_2026!')

    def _as(self, account):
        client = APIClient()
        client.force_authenticate(account)
        return client

    def test_liveness_stays_cheap_and_open(self):
        with self.assertNumQueries(0):
            response = APIClient().get('/api/ping/')

        self.assertEqual(response.status_code, 200)
        self.worker_ping.assert_not_called()

    def test_liveness_says_nothing_about_the_worker(self):
        self.worker_ping.return_value = []

        self.assertEqual(APIClient().get('/api/ping/').status_code, 200)

    def test_details_are_for_admins_only(self):
        self.assertIn(APIClient().get(self.URL).status_code, (401, 403))
        self.assertEqual(self._as(self.user).get(self.URL).status_code, 403)

    def test_ready_is_200(self):
        response = self._as(self.admin).get(self.URL)

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['ready'])

    def test_not_ready_is_503_with_the_detail(self):
        self.worker_ping.return_value = []

        response = self._as(self.admin).get(self.URL)

        self.assertEqual(response.status_code, 503)
        self.assertFalse(response.data['checks']['worker']['ok'])


class CommandTests(ReadinessTestCase):
    def test_exits_zero_when_ready(self):
        output = StringIO()

        call_command('readiness', stdout=output)

        self.assertIn('"ready": true', output.getvalue())

    def test_exits_non_zero_when_not_ready(self):
        self.worker_ping.return_value = []

        with self.assertRaises(SystemExit) as stopped:
            call_command('readiness', stdout=StringIO())

        self.assertEqual(stopped.exception.code, 1)
