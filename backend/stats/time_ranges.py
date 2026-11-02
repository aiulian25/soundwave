"""One reporting policy: days and years are the installation's local ones.

Ranges are half-open, so a year's last microsecond counts once and the next year's first
moment does not. Every page that shows a streak gets it from listening_streaks.
"""

from datetime import datetime, timedelta

from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework.exceptions import ValidationError

EARLIEST_REPORT_YEAR = 1970
LATEST_REPORT_YEAR = 2200
LONGEST_REPORT_DAYS = 36500
ONE_DAY = timedelta(days=1)


def local_today():
    return timezone.localtime().date()


def year_range(year):
    """[Jan 1, next Jan 1) of a local year."""
    return (
        timezone.make_aware(datetime(year, 1, 1)),
        timezone.make_aware(datetime(year + 1, 1, 1)),
    )


def requested_year(request):
    raw_year = request.query_params.get('year', local_today().year)
    try:
        year = int(raw_year)
    except (TypeError, ValueError) as error:
        raise ValidationError({'year': 'Must be a whole number.'}) from error
    if not EARLIEST_REPORT_YEAR <= year <= LATEST_REPORT_YEAR:
        raise ValidationError({'year': 'Out of range.'})
    return year


def requested_days(request, default):
    raw_days = request.query_params.get('days', default)
    try:
        days = int(raw_days)
    except (TypeError, ValueError) as error:
        raise ValidationError({'days': 'Must be a whole number.'}) from error
    if not 0 <= days <= LONGEST_REPORT_DAYS:
        raise ValidationError({'days': 'Out of range.'})
    return days


def listening_dates(history):
    """The local dates a listening-history queryset covers."""
    return set(history.annotate(date=TruncDate('listened_at')).values_list('date', flat=True).distinct())


def listening_streaks(dates, today=None):
    """(current, longest). A streak survives until a whole day passes, so it still counts today
    before today's first listen."""
    if not dates:
        return 0, 0

    today = today or local_today()
    check_date = today if today in dates else today - ONE_DAY
    current = 0
    while check_date in dates:
        current += 1
        check_date -= ONE_DAY

    longest = run = 1
    sorted_dates = sorted(dates)
    for previous, following in zip(sorted_dates, sorted_dates[1:]):
        run = run + 1 if following - previous == ONE_DAY else 1
        longest = max(longest, run)
    return current, longest
