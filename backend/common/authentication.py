"""Custom authentication classes"""

from rest_framework.authentication import SessionAuthentication
from common.expiring_token import ExpiringTokenAuthentication


class CsrfExemptSessionAuthentication(SessionAuthentication):
    """
    SessionAuthentication that doesn't enforce CSRF when a token is present.
    This allows both session and token auth to coexist without CSRF issues.
    """
    def enforce_csrf(self, request):
        # Don't enforce CSRF if Authorization header is present (token auth)
        if request.META.get('HTTP_AUTHORIZATION'):
            return
        # Otherwise, enforce CSRF for session auth
        return super().enforce_csrf(request)


class CsrfExemptTokenAuthentication(ExpiringTokenAuthentication):
    """
    Token authentication with expiry that doesn't require CSRF tokens.
    This is safe because tokens are stored in localStorage and sent via headers,
    not cookies, so they're not vulnerable to CSRF attacks.
    
    Tokens expire after TOKEN_EXPIRY_HOURS (default: 7 days).
    Configure in settings.py:
        TOKEN_EXPIRY_HOURS = 168  # 7 days
    """
    def enforce_csrf(self, request):
        return  # To not perform the csrf check

