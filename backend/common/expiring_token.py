"""
Expiring Token Authentication for Django REST Framework.

This module provides token authentication with configurable expiry times.
Tokens expire after a set period and users must re-authenticate.
"""

from datetime import timedelta
from django.conf import settings
from django.utils import timezone
from rest_framework.authentication import TokenAuthentication
from rest_framework.authtoken.models import Token
from rest_framework import exceptions


# Token expiry settings (can be overridden in settings.py)
# Default: 7 days for regular tokens
TOKEN_EXPIRY_HOURS = getattr(settings, 'TOKEN_EXPIRY_HOURS', 24 * 7)  # 7 days
# "Remember me" tokens last longer
TOKEN_EXPIRY_HOURS_EXTENDED = getattr(settings, 'TOKEN_EXPIRY_HOURS_EXTENDED', 24 * 30)  # 30 days


def is_token_expired(token):
    """
    Check if a token has expired.
    
    Args:
        token: Token object with 'created' timestamp
        
    Returns:
        bool: True if token is expired, False otherwise
    """
    if not token:
        return True
    
    expiry_hours = TOKEN_EXPIRY_HOURS
    expiry_time = token.created + timedelta(hours=expiry_hours)
    
    return timezone.now() > expiry_time


def get_token_remaining_time(token):
    """
    Get remaining time until token expires.
    
    Args:
        token: Token object with 'created' timestamp
        
    Returns:
        timedelta: Time remaining, or None if expired
    """
    if not token:
        return None
    
    expiry_hours = TOKEN_EXPIRY_HOURS
    expiry_time = token.created + timedelta(hours=expiry_hours)
    remaining = expiry_time - timezone.now()
    
    return remaining if remaining.total_seconds() > 0 else None


def refresh_token(user):
    """
    Delete existing token and create a new one for the user.
    This effectively "refreshes" the token and resets the expiry.
    
    Args:
        user: User object
        
    Returns:
        Token: New token object
    """
    Token.objects.filter(user=user).delete()
    return Token.objects.create(user=user)


class ExpiringTokenAuthentication(TokenAuthentication):
    """
    Token authentication that expires tokens after a configurable time.
    
    This extends Django REST Framework's TokenAuthentication to add
    expiry checking. Expired tokens are treated as invalid.
    
    Configure via settings.py:
        TOKEN_EXPIRY_HOURS = 168  # 7 days (default)
        TOKEN_EXPIRY_HOURS_EXTENDED = 720  # 30 days for "remember me"
    """
    
    def authenticate_credentials(self, key):
        """
        Authenticate the token, checking for expiry.
        
        Args:
            key: Token key string
            
        Returns:
            tuple: (user, token) if valid
            
        Raises:
            AuthenticationFailed: If token is invalid or expired
        """
        model = self.get_model()
        
        try:
            token = model.objects.select_related('user').get(key=key)
        except model.DoesNotExist:
            raise exceptions.AuthenticationFailed('Invalid token.')
        
        if not token.user.is_active:
            raise exceptions.AuthenticationFailed('User inactive or deleted.')
        
        # Check if token has expired
        if is_token_expired(token):
            # Delete the expired token
            token.delete()
            raise exceptions.AuthenticationFailed('Token has expired. Please log in again.')
        
        return (token.user, token)


class CsrfExemptExpiringTokenAuthentication(ExpiringTokenAuthentication):
    """
    Expiring token authentication that doesn't require CSRF tokens.
    
    This is safe because tokens are stored in localStorage and sent via headers,
    not cookies, so they're not vulnerable to CSRF attacks.
    """
    
    def enforce_csrf(self, request):
        return  # Don't perform CSRF check for token auth
