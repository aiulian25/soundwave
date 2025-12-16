"""Common views"""

from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.views import APIView


class ApiBaseView(APIView):
    """Base API view"""
    pass


class AdminOnly(IsAdminUser):
    """Admin only permission"""
    pass


class AdminWriteOnly(IsAuthenticated):
    """Allow all authenticated users to read and write their own data"""

    def has_permission(self, request, view):
        # All authenticated users can perform any action
        # Data isolation is enforced at the view/queryset level via owner field
        return request.user and request.user.is_authenticated
