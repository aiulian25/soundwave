"""User URL patterns"""

from django.urls import path, include
from user.views import (
    LoginView,
    LogoutView,
    RegisterView,
    UserAccountView,
    UserProfileView,
    ChangePasswordView,
    UserConfigView,
    TwoFactorStatusView,
    TwoFactorSetupView,
    TwoFactorVerifyView,
    TwoFactorDisableView,
    TwoFactorRegenerateCodesView,
    TwoFactorDownloadCodesView,
    AvatarUploadView,
    AvatarPresetView,
    AvatarFileView,
)

urlpatterns = [
    path('account/', UserAccountView.as_view(), name='user-account'),
    path('profile/', UserProfileView.as_view(), name='user-profile'),
    path('change-password/', ChangePasswordView.as_view(), name='change-password'),
    path('login/', LoginView.as_view(), name='user-login'),
    path('logout/', LogoutView.as_view(), name='user-logout'),
    path('register/', RegisterView.as_view(), name='user-register'),  # Returns 403 - disabled
    path('config/', UserConfigView.as_view(), name='user-config'),
    path('2fa/status/', TwoFactorStatusView.as_view(), name='2fa-status'),
    path('2fa/setup/', TwoFactorSetupView.as_view(), name='2fa-setup'),
    path('2fa/verify/', TwoFactorVerifyView.as_view(), name='2fa-verify'),
    path('2fa/disable/', TwoFactorDisableView.as_view(), name='2fa-disable'),
    path('2fa/regenerate-codes/', TwoFactorRegenerateCodesView.as_view(), name='2fa-regenerate'),
    path('2fa/download-codes/', TwoFactorDownloadCodesView.as_view(), name='2fa-download'),
    # Avatar management
    path('avatar/upload/', AvatarUploadView.as_view(), name='avatar-upload'),
    path('avatar/preset/', AvatarPresetView.as_view(), name='avatar-preset'),
    path('avatar/file/<str:filename>/', AvatarFileView.as_view(), name='avatar-file'),
    # Admin user management
    path('', include('user.urls_admin')),
]
