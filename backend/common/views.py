"""Common views"""

from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.authentication import SessionAuthentication, TokenAuthentication
from rest_framework.views import APIView


class ApiBaseView(APIView):
    """Base API view - TubeArchivist pattern"""
    authentication_classes = [SessionAuthentication, TokenAuthentication]
    permission_classes = [IsAuthenticated]


class AdminOnly(IsAdminUser):
    """Admin only permission"""
    pass


class AdminWriteOnly(IsAuthenticated):
    """Allow all authenticated users to read and write their own data"""

    def has_permission(self, request, view):
        # All authenticated users can perform any action
        # Data isolation is enforced at the view/queryset level via owner field
        return request.user and request.user.is_authenticated
