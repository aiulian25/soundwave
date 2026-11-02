"""Searching a list in the database, so a search costs one bounded page rather than a library."""

from functools import reduce
from operator import or_

from django.db.models import Q
from rest_framework.exceptions import ValidationError

MAX_SEARCH_TERM_LENGTH = 200


def search_term(request):
    """The requested search text, or an empty string when the list is not being searched."""
    term = request.query_params.get('q', '').strip()
    if len(term) > MAX_SEARCH_TERM_LENGTH:
        raise ValidationError({'q': 'Too long.'})
    return term


def matching(queryset, term, fields):
    """Rows where any field contains the term, ignoring case. No term means no restriction."""
    if not term:
        return queryset
    return queryset.filter(reduce(or_, (Q(**{f'{field}__icontains': term}) for field in fields)))
