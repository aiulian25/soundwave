"""What a smart playlist rule may say and the query it means, as one definition.

Saving, previewing, counting and listing all go through compile_rule, so nothing that
passes validation can fail later and no two paths can disagree about a rule.
"""

from datetime import timedelta
from functools import reduce
from operator import and_, or_

from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime

MATCH_ANY = 'any'
RATING_FIELD = 'rating'

# Stable codes the SPA translates; they are also what the API returns.
UNSUPPORTED_FIELD = 'unsupported_field'
UNSUPPORTED_OPERATOR = 'unsupported_operator'
VALUE_REQUIRED = 'value_required'
WHOLE_NUMBER_REQUIRED = 'whole_number_required'
NUMBER_OUT_OF_RANGE = 'number_out_of_range'
REVERSED_RANGE = 'reversed_range'
DATE_REQUIRED = 'date_required'
DATE_OUT_OF_RANGE = 'date_out_of_range'

FIRST_VALUE = 'value'
SECOND_VALUE = 'value_2'

SMALLEST_NUMBER = -(2 ** 31)
LARGEST_NUMBER = 2 ** 31 - 1
LARGEST_DAY_SPAN = 36500
EARLIEST_RULE_YEAR = 1900
LATEST_RULE_YEAR = 2200


class InvalidRule(Exception):
    def __init__(self, target, code):
        super().__init__(f'{target}: {code}')
        self.target = target
        self.code = code


def _required_text(raw_value):
    if not (raw_value or '').strip():
        raise InvalidRule(FIRST_VALUE, VALUE_REQUIRED)
    return raw_value


def _whole_number(raw_value, target, smallest=SMALLEST_NUMBER, largest=LARGEST_NUMBER):
    if not (raw_value or '').strip():
        raise InvalidRule(target, VALUE_REQUIRED)
    try:
        number = int(raw_value)
    except ValueError as error:
        raise InvalidRule(target, WHOLE_NUMBER_REQUIRED) from error
    if not smallest <= number <= largest:
        raise InvalidRule(target, NUMBER_OUT_OF_RANGE)
    return number


def _moment(raw_value):
    cleaned = (raw_value or '').strip()
    if not cleaned:
        raise InvalidRule(FIRST_VALUE, VALUE_REQUIRED)
    try:
        parsed = parse_datetime(cleaned)
    except ValueError as error:
        raise InvalidRule(FIRST_VALUE, DATE_REQUIRED) from error
    if parsed is None:
        raise InvalidRule(FIRST_VALUE, DATE_REQUIRED)
    if not EARLIEST_RULE_YEAR <= parsed.year <= LATEST_RULE_YEAR:
        raise InvalidRule(FIRST_VALUE, DATE_OUT_OF_RANGE)
    return timezone.make_aware(parsed) if timezone.is_naive(parsed) else parsed


def _days_ago(raw_value):
    days = _whole_number(raw_value, FIRST_VALUE, smallest=0, largest=LARGEST_DAY_SPAN)
    return timezone.now() - timedelta(days=days)


def _text_match(lookup):
    def compile_match(field, value, _second_value):
        return Q(**{f'{field}__{lookup}': _required_text(value)})
    return compile_match


def _number_comparison(lookup):
    def compile_comparison(field, value, _second_value):
        return Q(**{f'{field}__{lookup}': _whole_number(value, FIRST_VALUE)})
    return compile_comparison


def _negated(compile_predicate):
    def compile_negation(field, value, second_value):
        return ~compile_predicate(field, value, second_value)
    return compile_negation


def _number_between(field, value, second_value):
    low = _whole_number(value, FIRST_VALUE)
    high = _whole_number(second_value, SECOND_VALUE)
    if low > high:
        raise InvalidRule(SECOND_VALUE, REVERSED_RANGE)
    return Q(**{f'{field}__gte': low, f'{field}__lte': high})


def _date_comparison(lookup):
    def compile_comparison(field, value, _second_value):
        return Q(**{f'{field}__{lookup}': _moment(value)})
    return compile_comparison


def _in_last_days(field, value, _second_value):
    return Q(**{f'{field}__gte': _days_ago(value)})


def _not_in_last_days(field, value, _second_value):
    return Q(**{f'{field}__lt': _days_ago(value)}) | Q(**{f'{field}__isnull': True})


def _text_is_not_set(field, _value, _second_value):
    return Q(**{f'{field}__isnull': True}) | Q(**{field: ''})


def _date_is_not_set(field, _value, _second_value):
    return Q(**{f'{field}__isnull': True})


def _is_true(field, _value, _second_value):
    return Q(**{field: True})


def _is_false(field, _value, _second_value):
    return Q(**{field: False})


_contains = _text_match('icontains')
_text_equals = _text_match('iexact')
_number_equals = _number_comparison('exact')

COMPILERS_BY_TYPE = {
    'text': {
        'contains': _contains,
        'not_contains': _negated(_contains),
        'equals': _text_equals,
        'not_equals': _negated(_text_equals),
        'starts_with': _text_match('istartswith'),
        'ends_with': _text_match('iendswith'),
        'is_set': _negated(_text_is_not_set),
        'is_not_set': _text_is_not_set,
    },
    'numeric': {
        'equals': _number_equals,
        'not_equals': _negated(_number_equals),
        'greater_than': _number_comparison('gt'),
        'less_than': _number_comparison('lt'),
        'greater_equal': _number_comparison('gte'),
        'less_equal': _number_comparison('lte'),
        'between': _number_between,
    },
    'date': {
        'in_last_days': _in_last_days,
        'not_in_last_days': _not_in_last_days,
        'before_date': _date_comparison('lt'),
        'after_date': _date_comparison('gt'),
        'is_set': _negated(_date_is_not_set),
        'is_not_set': _date_is_not_set,
    },
    'boolean': {
        'is_true': _is_true,
        'is_false': _is_false,
    },
}

FIELD_TYPES = {
    'title': 'text',
    'artist': 'text',
    'album': 'text',
    'genre': 'text',
    'channel_name': 'text',
    'year': 'numeric',
    'play_count': 'numeric',
    'duration': 'numeric',
    RATING_FIELD: 'numeric',
    'last_played': 'date',
    'downloaded_date': 'date',
    'is_favorite': 'boolean',
}

OPERATOR_GROUPS = {field_type: list(compilers) for field_type, compilers in COMPILERS_BY_TYPE.items()}


def compile_rule(field, operator, value='', second_value=''):
    """The query a rule means; raises InvalidRule if it does not mean anything."""
    field_type = FIELD_TYPES.get(field)
    if field_type is None:
        raise InvalidRule('field', UNSUPPORTED_FIELD)
    compile_predicate = COMPILERS_BY_TYPE[field_type].get(operator)
    if compile_predicate is None:
        raise InvalidRule('operator', UNSUPPORTED_OPERATOR)
    return compile_predicate(field, value, second_value)


def rule_is_valid(rule):
    try:
        compile_rule(rule.field, rule.operator, rule.value, rule.value_2)
    except InvalidRule:
        return False
    return True


def rules_predicate(rules, match_mode):
    """All the rules as one query. No rules means no restriction."""
    predicates = [compile_rule(rule.field, rule.operator, rule.value, rule.value_2) for rule in rules]
    return reduce(or_ if match_mode == MATCH_ANY else and_, predicates, Q())
