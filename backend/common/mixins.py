"""Reusable view mixins for multi-tenant isolation (APP-04).

For DRF generic views / ViewSets. The bulk of SoundWave's API is built on plain
``APIView`` subclasses — those use ``ApiBaseView.filter_owned()`` instead.
"""


class OwnedQuerysetMixin:
    """Restrict a ViewSet's queryset to objects owned by the requesting user.

    Admins/superusers see everything (intended for management-style ViewSets).
    Set ``owner_field`` to match the model, or ``allow_admin_all = False`` to keep
    admins scoped to their own objects.
    """

    owner_field = 'owner'
    allow_admin_all = True

    def get_queryset(self):
        queryset = super().get_queryset()
        user = getattr(self.request, 'user', None)
        if user is None or not user.is_authenticated:
            return queryset.none()
        if self.allow_admin_all and (getattr(user, 'is_admin', False) or getattr(user, 'is_superuser', False)):
            return queryset
        return queryset.filter(**{self.owner_field: user})
