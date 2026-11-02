"""SW-016: every page agrees on days, years and streaks, in installation-local time.

Run: python manage.py test stats --settings=config.settings_test
"""
from datetime import date, datetime, timedelta
from unittest import mock
from zoneinfo import ZoneInfo

from django.test import SimpleTestCase, TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from audio.models import Audio
from stats.achievements import AchievementService
from stats.models import ListeningHistory
from stats.time_ranges import listening_dates, listening_streaks, local_today, year_range
from user.models import Account

BUCHAREST = ZoneInfo('Europe/Bucharest')


class StreakCalculationTests(SimpleTestCase):
    TODAY = date(2026, 6, 15)

    def _days_ago(self, *offsets):
        return {self.TODAY - timedelta(days=offset) for offset in offsets}

    def test_no_listening(self):
        self.assertEqual(listening_streaks(set(), self.TODAY), (0, 0))

    def test_counts_back_from_today(self):
        self.assertEqual(listening_streaks(self._days_ago(0, 1, 2), self.TODAY), (3, 3))

    def test_carries_from_yesterday_before_todays_first_listen(self):
        self.assertEqual(listening_streaks(self._days_ago(1, 2), self.TODAY), (2, 2))

    def test_broken_after_a_whole_missed_day(self):
        self.assertEqual(listening_streaks(self._days_ago(2, 3, 4), self.TODAY), (0, 3))

    def test_longest_is_kept_when_it_is_in_the_past(self):
        self.assertEqual(listening_streaks(self._days_ago(0, 5, 6, 7, 8), self.TODAY), (1, 4))

    def test_single_day(self):
        self.assertEqual(listening_streaks(self._days_ago(0), self.TODAY), (1, 1))


@override_settings(TIME_ZONE='Europe/Bucharest')
class LocalReportingTests(TestCase):
    def setUp(self):
        self.owner = Account.objects.create_user('range_u', 'range_u@test.local', 'Rangepw_2026!')
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.track = Audio.objects.create(
            owner=self.owner, youtube_id='RANGE_1', title='A Track', channel_id='UC', channel_name='Chan',
            duration=180, file_path='range.m4a', file_size=1, published_date=timezone.now(),
        )

    def _listen(self, moment):
        return ListeningHistory.objects.create(
            user=self.owner, audio=self.track, title='A Track', channel_name='Chan',
            duration_listened=60, listened_at=moment,
        )

    def _wrapped(self, year):
        return self.client.get('/api/stats/wrapped/', {'year': year})

    def test_year_range_is_local_and_half_open(self):
        with timezone.override(BUCHAREST):
            start, end = year_range(2026)

        self.assertEqual(start, datetime(2026, 1, 1, tzinfo=BUCHAREST))
        self.assertEqual(end, datetime(2027, 1, 1, tzinfo=BUCHAREST))

    def test_final_microsecond_of_a_year_counts_once_and_in_that_year(self):
        with timezone.override(BUCHAREST):
            self._listen(datetime(2025, 12, 31, 23, 59, 59, 999999, tzinfo=BUCHAREST))
            self._listen(datetime(2026, 1, 1, 0, 0, tzinfo=BUCHAREST))

            self.assertEqual(self._wrapped(2025).data['total_tracks_played'], 1)
            self.assertEqual(self._wrapped(2026).data['total_tracks_played'], 1)

    def test_new_year_follows_local_time_not_utc(self):
        with timezone.override(BUCHAREST):
            # 23:30 UTC on Dec 31 is already 01:30 on Jan 1 in Bucharest.
            self._listen(datetime(2025, 12, 31, 23, 30, tzinfo=ZoneInfo('UTC')))

            self.assertEqual(self._wrapped(2025).status_code, 404)
            self.assertEqual(self._wrapped(2026).data['total_tracks_played'], 1)

    def test_days_either_side_of_a_clock_change_are_consecutive(self):
        with timezone.override(BUCHAREST):
            # Clocks go forward on 2026-03-29 in Bucharest, so that day has 23 hours.
            self._listen(datetime(2026, 3, 28, 23, 30, tzinfo=BUCHAREST))
            self._listen(datetime(2026, 3, 29, 23, 30, tzinfo=BUCHAREST))
            self._listen(datetime(2026, 3, 30, 0, 30, tzinfo=BUCHAREST))

            dates = listening_dates(ListeningHistory.objects.filter(user=self.owner))

            self.assertEqual(dates, {date(2026, 3, 28), date(2026, 3, 29), date(2026, 3, 30)})
            self.assertEqual(listening_streaks(dates, date(2026, 3, 30)), (3, 3))

    def test_all_pages_agree_on_streaks(self):
        with timezone.override(BUCHAREST):
            now = timezone.localtime()
            # Yesterday and the day before only, and outside a short insights window's today.
            self._listen(now - timedelta(days=1))
            self._listen(now - timedelta(days=2))
            for days_ago in (40, 41, 42):
                self._listen(now - timedelta(days=days_ago))

            streak = self.client.get('/api/stats/streak/').data
            insights = self.client.get('/api/stats/insights/', {'days': 7}).data
            achievement_current, achievement_longest = AchievementService(self.owner)._calculate_streaks()

            self.assertEqual(streak['current_streak'], 2)
            self.assertTrue(streak['streak_at_risk'])
            self.assertEqual(insights['current_streak'], 2)
            self.assertEqual(achievement_current, 2)
            self.assertEqual(streak['longest_streak'], 3)
            self.assertEqual(streak['longest_streak'], insights['longest_streak'])
            self.assertEqual(streak['longest_streak'], achievement_longest)

    def test_on_this_day_uses_the_local_date(self):
        # 22:30 UTC is already the next day in Bucharest.
        moment = datetime(2026, 6, 10, 22, 30, tzinfo=ZoneInfo('UTC'))
        with timezone.override(BUCHAREST), mock.patch('django.utils.timezone.now', return_value=moment):
            self._listen(moment - timedelta(days=7))

            response = self.client.get('/api/stats/on-this-day/')

            self.assertEqual(response.data['one_week_ago']['date'], '2026-06-04')

    def test_bad_days_and_years_are_refused_not_server_errors(self):
        requests = [
            ('/api/stats/wrapped/', {'year': 'soon'}),
            ('/api/stats/wrapped/', {'year': 1}),
            ('/api/stats/wrapped/', {'year': 99999}),
            ('/api/stats/insights/', {'days': 'many'}),
            ('/api/stats/insights/', {'days': -1}),
            ('/api/stats/insights/', {'days': 10 ** 12}),
        ]
        for url, params in requests:
            with self.subTest(url=url, params=params):
                self.assertEqual(self.client.get(url, params).status_code, 400)

    def test_clearing_history_refuses_a_bad_cutoff_and_keeps_the_rows(self):
        self._listen(timezone.now())

        self.assertEqual(self.client.delete('/api/stats/history/?days=abc').status_code, 400)
        self.assertEqual(ListeningHistory.objects.count(), 1)

    def test_clearing_history_with_a_cutoff_keeps_recent_rows(self):
        self._listen(timezone.now())
        self._listen(timezone.now() - timedelta(days=10))

        response = self.client.delete('/api/stats/history/?days=5')

        self.assertEqual(response.data['deleted'], 1)
        self.assertEqual(ListeningHistory.objects.count(), 1)

    def test_local_today_is_the_installations_date(self):
        with timezone.override(BUCHAREST):
            self.assertEqual(local_today(), timezone.now().astimezone(BUCHAREST).date())
