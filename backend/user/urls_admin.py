"""URL configuration for admin user management"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter
from user.views_admin import UserManagementViewSet, UserYouTubeAccountViewSet

router = DefaultRouter()
router.register(r'users', UserManagementViewSet, basename='admin-users')
router.register(r'youtube-accounts', UserYouTubeAccountViewSet, basename='youtube-accounts')

urlpatterns = [
    path('admin/', include(router.urls)),
]
