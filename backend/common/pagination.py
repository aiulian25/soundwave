"""One page of a list, with explicit continuation so no client has to guess when to stop."""

from rest_framework.exceptions import ValidationError
from rest_framework.response import Response

PAGE_SIZE = 50
FIRST_PAGE = 1


def _requested_page(request):
    raw_page = request.query_params.get('page', FIRST_PAGE)
    try:
        page = int(raw_page)
    except (TypeError, ValueError) as error:
        raise ValidationError({'page': 'Must be a positive whole number.'}) from error
    if page < FIRST_PAGE:
        raise ValidationError({'page': 'Must be a positive whole number.'})
    return page


def paginated_response(request, queryset, serializer_class):
    """`queryset` needs a total order, or rows can repeat or vanish between pages."""
    page = _requested_page(request)
    count = queryset.count()
    start = (page - FIRST_PAGE) * PAGE_SIZE
    end = start + PAGE_SIZE
    return Response({
        'data': serializer_class(queryset[start:end], many=True).data,
        'paginate': True,
        'count': count,
        'page': page,
        'page_size': PAGE_SIZE,
        'next': page + 1 if end < count else None,
    })
