"""SW-013: smart rules are checked before anything is saved, and every path agrees on them.

Run: python manage.py test playlist --settings=config.settings_test
"""
import random
from datetime import timedelta
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from audio.models import Audio
from playlist.models_smart import SmartPlaylist, SmartPlaylistRule, create_system_smart_playlists
from playlist.views_smart import PREVIEW_SIZE
from playlist.smart_rules import COMPILERS_BY_TYPE, FIELD_TYPES, InvalidRule, compile_rule
from user.models import Account

LIST_URL = '/api/playlist/smart/'
PREVIEW_URL = '/api/playlist/smart/preview/'


def _rule(field='year', operator='greater_than', value='1990', **extra):
    return {'field': field, 'operator': operator, 'value': value, **extra}


class SmartRuleTestCase(TestCase):
    def setUp(self):
        self.owner = Account.objects.create_user('smart_u', 'smart_u@test.local', 'Smartpw_2026!')
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def _track(self, youtube_id, owner=None, **fields):
        return Audio.objects.create(
            owner=owner or self.owner, youtube_id=youtube_id, title=youtube_id, channel_id='UC', channel_name='Chan',
            duration=60, file_path=f'{youtube_id}.m4a', file_size=1, published_date=timezone.now(), **fields,
        )

    def _playlist(self, rules=(), **fields):
        playlist = SmartPlaylist.objects.create(owner=self.owner, name=fields.pop('name', 'Mine'), **fields)
        for position, rule in enumerate(rules):
            SmartPlaylistRule.objects.create(smart_playlist=playlist, order=position, **rule)
        return playlist

    def _detail_url(self, playlist, suffix=''):
        return f'{LIST_URL}{playlist.pk}/{suffix}'


class RuleValidationTests(SmartRuleTestCase):
    def _rejected_with(self, rule):
        response = self.client.post(LIST_URL, {'name': 'New', 'rules': [rule]}, format='json')
        self.assertEqual(response.status_code, 400, rule)
        self.assertFalse(SmartPlaylist.objects.filter(owner=self.owner, name='New').exists())
        return response.data['rules'][0]

    def test_values_that_do_not_fit_the_field_are_rejected_with_their_reason(self):
        cases = [
            (_rule(value='soon'), 'value', 'whole_number_required'),
            (_rule(value=''), 'value', 'value_required'),
            (_rule(value=str(2 ** 40)), 'value', 'number_out_of_range'),
            (_rule(operator='between', value='5'), 'value_2', 'value_required'),
            (_rule(operator='between', value='5', value_2='x'), 'value_2', 'whole_number_required'),
            (_rule(operator='between', value='9', value_2='5'), 'value_2', 'reversed_range'),
            (_rule('last_played', 'in_last_days', 'lots'), 'value', 'whole_number_required'),
            (_rule('last_played', 'in_last_days', '-1'), 'value', 'number_out_of_range'),
            (_rule('last_played', 'in_last_days', str(10 ** 12)), 'value', 'number_out_of_range'),
            (_rule('last_played', 'before_date', 'yesterday'), 'value', 'date_required'),
            (_rule('last_played', 'before_date', '2026-13-45'), 'value', 'date_required'),
            (_rule('last_played', 'before_date', '2026-01-01 25:00:00'), 'value', 'date_required'),
            (_rule('last_played', 'before_date', '0001-01-01'), 'value', 'date_out_of_range'),
            (_rule('title', 'contains', '   '), 'value', 'value_required'),
        ]
        for rule, target, code in cases:
            with self.subTest(rule=rule):
                self.assertEqual(self._rejected_with(rule)[target], [code])

    def test_operator_must_suit_the_field(self):
        cases = [('title', 'greater_than'), ('year', 'contains'), ('is_favorite', 'equals'), ('last_played', 'is_true')]
        for field, operator in cases:
            with self.subTest(field=field, operator=operator):
                self.assertEqual(self._rejected_with(_rule(field, operator))['operator'], ['unsupported_operator'])

    def test_unknown_names_are_rejected(self):
        self.assertIn('field', self._rejected_with(_rule(field='password')))
        self.assertIn('operator', self._rejected_with(_rule(operator='regex')))

    def test_every_operator_has_a_working_query(self):
        values = {
            'between': ('1', '2'),
            'before_date': ('2020-01-01', ''),
            'after_date': ('2020-01-01T10:00:00Z', ''),
        }
        self._track('ANY')
        for field, field_type in FIELD_TYPES.items():
            for operator in COMPILERS_BY_TYPE[field_type]:
                value, second_value = values.get(operator, ('5', ''))
                with self.subTest(field=field, operator=operator):
                    predicate = compile_rule(field, operator, value, second_value)
                    list(Audio.objects.filter(owner=self.owner).filter(predicate))

    def test_limit_must_be_a_positive_number(self):
        for limit in (-1, 0, 2 ** 40, 'many'):
            with self.subTest(limit=limit):
                response = self.client.post(LIST_URL, {'name': 'New', 'limit': limit}, format='json')
                self.assertEqual(response.status_code, 400)
                self.assertIn('limit', response.data)

    def test_limit_is_held_to_the_same_bounds_on_update(self):
        playlist = self._playlist([], limit=5)

        response = self.client.put(self._detail_url(playlist), {'limit': -1}, format='json')

        self.assertEqual(response.status_code, 400)
        playlist.refresh_from_db()
        self.assertEqual(playlist.limit, 5)

    def test_order_in_the_request_is_ignored(self):
        rules = [_rule(order=7), _rule(value='2000', order=7)]

        response = self.client.post(LIST_URL, {'name': 'New', 'rules': rules}, format='json')

        self.assertEqual(response.status_code, 201)
        self.assertEqual([rule['order'] for rule in response.data['rules']], [0, 1])

    def test_ui_presets_and_system_playlists_are_valid(self):
        presets = [
            _rule('play_count', 'greater_than', '0'),
            _rule('downloaded_date', 'in_last_days', '30'),
            _rule('is_favorite', 'is_true', ''),
            _rule('genre', 'contains', 'rock'),
            _rule('artist', 'contains', 'someone'),
            _rule('duration', 'less_than', '180'),
        ]
        response = self.client.post(LIST_URL, {'name': 'Presets', 'rules': presets}, format='json')
        self.assertEqual(response.status_code, 201, response.data)

        create_system_smart_playlists(self.owner)
        for playlist in SmartPlaylist.objects.filter(owner=self.owner):
            self.assertEqual(playlist.invalid_rule_ids(), [], playlist.name)

    def test_choices_offer_exactly_what_the_server_accepts(self):
        data = self.client.get(f'{LIST_URL}choices/').data

        for field_type, operators in data['operator_groups'].items():
            self.assertEqual(operators, list(COMPILERS_BY_TYPE[field_type]))
        self.assertEqual(data['field_types'], FIELD_TYPES)
        self.assertEqual({field['value'] for field in data['fields']}, set(FIELD_TYPES))


class RuleReplacementTests(SmartRuleTestCase):
    def setUp(self):
        super().setUp()
        self.playlist = self._playlist([_rule(value='1990')], match_mode='all')

    def _stored_values(self):
        return list(self.playlist.rules.values_list('value', flat=True))

    def test_one_invalid_rule_keeps_the_old_playlist_on_every_write_path(self):
        rules = [_rule(value='2000'), _rule(value='soon')]
        requests = [
            (self.client.put, self._detail_url(self.playlist), {'rules': rules, 'match_mode': 'any'}),
            (self.client.put, self._detail_url(self.playlist, 'rules/'), {'rules': rules}),
        ]
        for send, url, body in requests:
            with self.subTest(url=url):
                response = send(url, body, format='json')

                self.assertEqual(response.status_code, 400)
                self.assertEqual(list(response.data['rules']), [1])
                self.assertEqual(response.data['rules'][1]['value'], ['whole_number_required'])
                self.assertEqual(self._stored_values(), ['1990'])
                self.playlist.refresh_from_db()
                self.assertEqual(self.playlist.match_mode, 'all')

    def test_adding_one_invalid_rule_is_rejected(self):
        response = self.client.post(self._detail_url(self.playlist, 'rules/'), _rule(value='soon'), format='json')

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self._stored_values(), ['1990'])

    def test_failure_while_writing_rolls_back_on_every_write_path(self):
        real_create = SmartPlaylistRule.objects.create
        calls = []

        def fail_on_second_rule(**fields):
            calls.append(fields)
            if len(calls) % 2 == 0:
                raise RuntimeError('database went away')
            return real_create(**fields)

        rules = [_rule(value='2000'), _rule(value='2001')]
        client = APIClient(raise_request_exception=False)
        client.force_authenticate(self.owner)
        with mock.patch.object(SmartPlaylistRule.objects, 'create', fail_on_second_rule):
            for url, body in (
                (self._detail_url(self.playlist), {'rules': rules, 'match_mode': 'any'}),
                (self._detail_url(self.playlist, 'rules/'), {'rules': rules}),
            ):
                with self.subTest(url=url):
                    self.assertEqual(client.put(url, body, format='json').status_code, 500)
                    self.assertEqual(self._stored_values(), ['1990'])
                    self.playlist.refresh_from_db()
                    self.assertEqual(self.playlist.match_mode, 'all')
            self.assertEqual(
                client.post(LIST_URL, {'name': 'Half', 'rules': rules}, format='json').status_code, 500,
            )
        self.assertFalse(SmartPlaylist.objects.filter(name='Half').exists())

    def test_valid_replacement_takes_effect_in_order(self):
        rules = [_rule(value='2000'), _rule(value='2001')]

        response = self.client.put(self._detail_url(self.playlist, 'rules/'), {'rules': rules}, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._stored_values(), ['2000', '2001'])
        self.assertEqual([rule['order'] for rule in response.data['data']], [0, 1])

    def test_replacing_rules_needs_an_explicit_list(self):
        url = self._detail_url(self.playlist, 'rules/')

        self.assertEqual(self.client.put(url, {}, format='json').status_code, 400)
        self.assertEqual(self.client.put(url, [], format='json').status_code, 400)
        self.assertEqual(self.client.put(url, {'rules': 'none'}, format='json').status_code, 400)
        self.assertEqual(self._stored_values(), ['1990'])

        self.assertEqual(self.client.put(url, {'rules': []}, format='json').status_code, 200)
        self.assertEqual(self._stored_values(), [])

    def test_counts_are_fresh_right_after_any_edit(self):
        self._track('RECENT', year=2000)
        self._track('OLD', year=1980)
        self.assertEqual(self.client.get(self._detail_url(self.playlist)).data['track_count'], 1)

        edits = [
            (self.client.put, self._detail_url(self.playlist), {'rules': [_rule(value='1970')]}, 2),
            (self.client.put, self._detail_url(self.playlist, 'rules/'), {'rules': [_rule(value='1990')]}, 1),
            (self.client.post, self._detail_url(self.playlist, 'rules/'), _rule(value='2010'), 0),
            (self.client.put, self._detail_url(self.playlist), {'rules': [], 'limit': 1}, 1),
        ]
        for send, url, body, expected_count in edits:
            with self.subTest(url=url, body=body):
                send(url, body, format='json')
                self.assertEqual(self.client.get(self._detail_url(self.playlist)).data['track_count'], expected_count)

    def test_count_is_fresh_after_an_edit_that_leaves_the_rules_alone(self):
        self._track('FIRST', year=2000)
        self._track('SECOND', year=2001)
        self.assertEqual(self.client.get(self._detail_url(self.playlist)).data['track_count'], 2)

        self.client.put(self._detail_url(self.playlist), {'limit': 1}, format='json')

        self.assertEqual(self.client.get(self._detail_url(self.playlist)).data['track_count'], 1)

    def test_system_playlist_rules_stay_read_only(self):
        system = self._playlist([_rule()], name='System', is_system=True)

        response = self.client.put(self._detail_url(system, 'rules/'), {'rules': []}, format='json')

        self.assertEqual(response.status_code, 403)
        self.assertEqual(system.rules.count(), 1)


class StoredInvalidRuleTests(SmartRuleTestCase):
    """Rows from before validation, or from the admin, must not break the owner's pages."""

    def setUp(self):
        super().setUp()
        self._track('ONE', year=2000)
        self.broken_rules = [
            _rule(value='soon'),
            _rule('last_played', 'is_true'),
            _rule('last_played', 'in_last_days', str(10 ** 12)),
            _rule('title', 'greater_than', 'x'),
        ]

    def test_pages_keep_working_and_flag_the_rule_without_deleting_it(self):
        for index, rule in enumerate(self.broken_rules):
            with self.subTest(rule=rule):
                playlist = self._playlist([rule], name=f'Broken {index}')

                listing = self.client.get(LIST_URL)
                tracks = self.client.get(self._detail_url(playlist, 'tracks/'))

                self.assertEqual(listing.status_code, 200)
                row = next(item for item in listing.data['data'] if item['id'] == playlist.pk)
                stored_rule = playlist.rules.get()
                self.assertEqual(row['invalid_rule_ids'], [stored_rule.pk])
                self.assertEqual(row['track_count'], 0)
                self.assertEqual(tracks.status_code, 200)
                self.assertEqual(tracks.data['data'], [])
                self.assertEqual(tracks.data['playlist']['invalid_rule_ids'], [stored_rule.pk])
                self.assertEqual(self.client.get(self._detail_url(playlist)).status_code, 200)

    def test_it_matches_nothing_rather_than_widening_the_playlist(self):
        self._track('TWO', year=1980)
        for match_mode in ('all', 'any'):
            with self.subTest(match_mode=match_mode):
                playlist = self._playlist(
                    [_rule(value='1990'), _rule(value='soon')], name=f'Mixed {match_mode}', match_mode=match_mode,
                )
                self.assertEqual(playlist.get_track_count(), 0)

    def test_owner_can_repair_it(self):
        playlist = self._playlist([_rule(value='soon')])

        response = self.client.put(self._detail_url(playlist), {'rules': [_rule(value='1990')]}, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['invalid_rule_ids'], [])
        self.assertEqual(response.data['track_count'], 1)

    def test_nonsense_stored_limit_does_not_break_a_page(self):
        for order_by in ('title', 'random'):
            with self.subTest(order_by=order_by):
                playlist = self._playlist([], name=f'Limit {order_by}', limit=-1, order_by=order_by)
                response = self.client.get(self._detail_url(playlist, 'tracks/'))
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data['total_count'], 1)
                self.assertEqual(len(response.data['data']), 1)


class MatchParityTests(SmartRuleTestCase):
    def setUp(self):
        super().setUp()
        self.stranger = Account.objects.create_user('smart_s', 'smart_s@test.local', 'Smartpw_2026!')
        self._track('ROCK', genre='rock', year=1980)
        self._track('NEW', genre='pop', year=2020)
        self._track('NEITHER', genre='pop', year=1980)
        self._track('STRANGER', owner=self.stranger, genre='rock', year=2020)
        self.rules = [_rule('genre', 'equals', 'rock'), _rule('year', 'greater_than', '2000')]

    def _ids(self, tracks):
        return {track['youtube_id'] for track in tracks}

    def test_count_tracks_and_preview_agree_for_every_mode_and_order(self):
        expected = {'all': set(), 'any': {'ROCK', 'NEW'}}
        for match_mode, matching in expected.items():
            for order_by in ('title', 'random'):
                with self.subTest(match_mode=match_mode, order_by=order_by):
                    playlist = self._playlist(
                        self.rules, name=f'{match_mode} {order_by}', match_mode=match_mode, order_by=order_by,
                    )
                    tracks = self.client.get(self._detail_url(playlist, 'tracks/')).data
                    preview = self.client.post(
                        PREVIEW_URL, {'rules': self.rules, 'match_mode': match_mode, 'order_by': order_by}, format='json',
                    ).data

                    self.assertEqual(self._ids(tracks['data']), matching)
                    self.assertEqual(tracks['total_count'], len(matching))
                    self.assertEqual(playlist.get_track_count(), len(matching))
                    self.assertEqual(preview['total_count'], len(matching))
                    self.assertEqual(self._ids(preview['preview']), matching)

    def test_limit_counts_the_same_everywhere(self):
        for order_by in ('title', 'random'):
            with self.subTest(order_by=order_by):
                playlist = self._playlist([], name=f'Capped {order_by}', limit=2, order_by=order_by)
                tracks = self.client.get(self._detail_url(playlist, 'tracks/')).data
                preview = self.client.post(PREVIEW_URL, {'limit': 2, 'order_by': order_by}, format='json').data

                self.assertEqual(len(tracks['data']), 2)
                self.assertEqual(tracks['total_count'], 2)
                self.assertEqual(tracks['next'], None)
                self.assertEqual(preview['total_count'], 2)
                self.assertEqual(len(preview['preview']), 2)

    def test_preview_is_a_short_sample_but_counts_everything(self):
        for index in range(PREVIEW_SIZE + 1):
            self._track(f'EXTRA_{index}', genre='jazz')

        response = self.client.post(PREVIEW_URL, {'rules': [_rule('genre', 'equals', 'jazz')]}, format='json')

        self.assertEqual(response.data['total_count'], PREVIEW_SIZE + 1)
        self.assertEqual(len(response.data['preview']), PREVIEW_SIZE)

    def test_preview_rejects_what_saving_would_reject(self):
        for body, target in (
            ({'rules': [_rule(value='soon')]}, 'rules'),
            ({'limit': 'many'}, 'limit'),
            ({'limit': -1}, 'limit'),
            ({'order_by': 'password'}, 'order_by'),
            ({'match_mode': 'some'}, 'match_mode'),
        ):
            with self.subTest(body=body):
                response = self.client.post(PREVIEW_URL, body, format='json')
                self.assertEqual(response.status_code, 400)
                self.assertIn(target, response.data)

    def test_date_is_set_works_on_a_real_date_column(self):
        played = self._track('PLAYED', last_played=timezone.now() - timedelta(days=2))
        is_set = self._playlist([_rule('last_played', 'is_set', '')], name='Set')
        not_set = self._playlist([_rule('last_played', 'is_not_set', '')], name='Unset')
        recent = self._playlist([_rule('last_played', 'in_last_days', '7')], name='Recent')
        long_ago = self._playlist([_rule('last_played', 'not_in_last_days', '1')], name='Long ago')

        self.assertEqual(list(is_set.matching_tracks()), [played])
        self.assertEqual(not_set.get_track_count(), 3)
        self.assertEqual(list(recent.matching_tracks()), [played])
        self.assertEqual(long_ago.get_track_count(), 4)

    def test_text_equals_ignores_case_and_number_equals_is_exact(self):
        text = self._playlist([_rule('genre', 'equals', 'ROCK')], name='Text')
        number = self._playlist([_rule('year', 'equals', '1980')], name='Number')
        different = self._playlist([_rule('year', 'not_equals', '1980')], name='Different')

        self.assertEqual(text.get_track_count(), 1)
        self.assertEqual(number.get_track_count(), 2)
        self.assertEqual(different.get_track_count(), 1)

    def test_unknown_rule_shape_is_never_a_server_error(self):
        with self.assertRaises(InvalidRule):
            compile_rule(None, None)
        for body in ({'rules': [{}]}, {'rules': ['nope']}, {'rules': 'nope'}, []):
            with self.subTest(body=body):
                self.assertEqual(self.client.post(PREVIEW_URL, body, format='json').status_code, 400)


class TrackPagingTests(SmartRuleTestCase):
    TRACK_TOTAL = 7

    def setUp(self):
        super().setUp()
        for index in range(self.TRACK_TOTAL):
            self._track(f'PAGE_{index}', play_count=1)

    def _walk(self, playlist, seed=None):
        """Every page in order, sending back the seed the first page chose."""
        pages = []
        params = {'page': 1, 'page_size': 3}
        if seed is not None:
            params['seed'] = seed
        for _attempt in range(self.TRACK_TOTAL):
            data = self.client.get(self._detail_url(playlist, 'tracks/'), params).data
            pages.append(data)
            if data['next'] is None:
                return pages
            params = {**params, 'page': data['next']}
            if data['seed'] is not None:
                params['seed'] = data['seed']
        self.fail('paging did not end')

    def _order(self, pages):
        return [track['youtube_id'] for page in pages for track in page['data']]

    def test_random_pages_are_bounded_and_cover_everything_once(self):
        playlist = self._playlist([], order_by='random')

        pages = self._walk(playlist)

        self.assertEqual([len(page['data']) for page in pages], [3, 3, 1])
        self.assertEqual(sorted(self._order(pages)), sorted(f'PAGE_{index}' for index in range(self.TRACK_TOTAL)))
        self.assertEqual(pages[0]['total_count'], self.TRACK_TOTAL)

    def test_same_seed_repeats_the_order_and_a_new_walk_differs(self):
        playlist = self._playlist([], order_by='random')

        self.assertEqual(self._order(self._walk(playlist, seed=11)), self._order(self._walk(playlist, seed=11)))
        orders = {tuple(self._order(self._walk(playlist, seed=seed))) for seed in range(20)}
        self.assertGreater(len(orders), 1)

    def test_tracks_arrive_in_the_shuffled_order_within_each_page(self):
        playlist = self._playlist([], order_by='random')
        shuffled_ids = list(Audio.objects.filter(owner=self.owner).order_by('id').values_list('youtube_id', flat=True))
        random.Random(11).shuffle(shuffled_ids)

        self.assertEqual(self._order(self._walk(playlist, seed=11)), shuffled_ids)

    def test_server_chooses_a_seed_for_random_only(self):
        random_playlist = self._playlist([], name='R', order_by='random')
        sorted_playlist = self._playlist([], name='S', order_by='title')

        self.assertIsInstance(self.client.get(self._detail_url(random_playlist, 'tracks/')).data['seed'], int)
        self.assertIsNone(self.client.get(self._detail_url(sorted_playlist, 'tracks/')).data['seed'])

    def test_limit_with_a_seed_is_a_stable_selection(self):
        playlist = self._playlist([], order_by='random', limit=4)

        pages = self._walk(playlist, seed=5)

        self.assertEqual(len(self._order(pages)), 4)
        self.assertEqual(self._order(pages), self._order(self._walk(playlist, seed=5)))
        self.assertEqual(pages[0]['total_count'], 4)

    def test_bad_seed_is_rejected(self):
        playlist = self._playlist([], order_by='random')

        response = self.client.get(self._detail_url(playlist, 'tracks/'), {'seed': 'abc'})

        self.assertEqual(response.status_code, 400)
        self.assertIn('seed', response.data)

    def test_ties_in_the_chosen_order_cannot_repeat_or_skip_tracks(self):
        playlist = self._playlist([], order_by='play_count')

        order = self._order(self._walk(playlist))

        self.assertEqual(len(order), self.TRACK_TOTAL)
        self.assertEqual(len(set(order)), self.TRACK_TOTAL)
        self.assertIn(' ORDER BY ', str(playlist.tracks_page(0, 3).query))
        self.assertIn('"id" ASC', str(playlist.tracks_page(0, 3).query).split(' ORDER BY ')[1])

    def test_inline_tracks_are_bounded_too(self):
        playlist = self._playlist([], order_by='random')

        with mock.patch('playlist.views_smart.MAX_TRACKS_PAGE_SIZE', 2):
            response = self.client.get(self._detail_url(playlist), {'include_tracks': 'true'})

        self.assertEqual(len(response.data['tracks']), 2)

    def test_empty_random_playlist_is_an_empty_page(self):
        playlist = self._playlist([_rule('genre', 'equals', 'nothing')], order_by='random')

        response = self.client.get(self._detail_url(playlist, 'tracks/'))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['data'], [])
        self.assertIsNone(response.data['next'])

    def test_another_owner_cannot_read_the_tracks(self):
        playlist = self._playlist([])
        stranger = Account.objects.create_user('smart_x', 'smart_x@test.local', 'Smartpw_2026!')
        client = APIClient()
        client.force_authenticate(stranger)

        self.assertEqual(client.get(self._detail_url(playlist, 'tracks/')).status_code, 404)
