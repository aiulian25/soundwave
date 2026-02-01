"""
Rate limiting and login attempt tracking for security.
"""

from django.core.cache import cache
from django.conf import settings
from rest_framework.throttling import AnonRateThrottle, UserRateThrottle
from datetime import datetime, timedelta
import hashlib


# Login attempt settings
MAX_LOGIN_ATTEMPTS = getattr(settings, 'MAX_LOGIN_ATTEMPTS', 3)
LOGIN_LOCKOUT_DURATION = getattr(settings, 'LOGIN_LOCKOUT_DURATION', 60 * 60)  # 60 minutes in seconds


def get_client_ip(request):
    """Extract client IP from request, handling proxies."""
    x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if x_forwarded_for:
        ip = x_forwarded_for.split(',')[0].strip()
    else:
        ip = request.META.get('REMOTE_ADDR', '')
    return ip


def get_login_attempt_key(ip_address, username=None):
    """Generate cache key for login attempts."""
    # Create a composite key using IP and optionally username
    identifier = f"{ip_address}"
    if username:
        identifier = f"{ip_address}:{username}"
    key_hash = hashlib.md5(identifier.encode()).hexdigest()
    return f"login_attempts:{key_hash}"


def get_lockout_key(ip_address, username=None):
    """Generate cache key for lockout status."""
    identifier = f"{ip_address}"
    if username:
        identifier = f"{ip_address}:{username}"
    key_hash = hashlib.md5(identifier.encode()).hexdigest()
    return f"login_lockout:{key_hash}"


def is_locked_out(request, username=None):
    """
    Check if the IP/username combination is locked out.
    Returns (is_locked, remaining_seconds).
    """
    ip_address = get_client_ip(request)
    lockout_key = get_lockout_key(ip_address, username)
    
    lockout_until = cache.get(lockout_key)
    if lockout_until:
        now = datetime.now()
        if now < lockout_until:
            remaining = (lockout_until - now).total_seconds()
            return True, int(remaining)
        else:
            # Lockout expired, clear it
            cache.delete(lockout_key)
    
    return False, 0


def record_failed_attempt(request, username=None):
    """
    Record a failed login attempt.
    Returns (attempt_count, is_now_locked, lockout_duration).
    """
    ip_address = get_client_ip(request)
    attempt_key = get_login_attempt_key(ip_address, username)
    lockout_key = get_lockout_key(ip_address, username)
    
    # Get current attempt count
    attempts = cache.get(attempt_key, 0) + 1
    
    # Store attempt count with expiry (reset after lockout duration even if no lockout)
    cache.set(attempt_key, attempts, LOGIN_LOCKOUT_DURATION)
    
    # Check if we should lock out
    if attempts >= MAX_LOGIN_ATTEMPTS:
        # Set lockout
        lockout_until = datetime.now() + timedelta(seconds=LOGIN_LOCKOUT_DURATION)
        cache.set(lockout_key, lockout_until, LOGIN_LOCKOUT_DURATION)
        # Clear attempt counter (will restart after lockout)
        cache.delete(attempt_key)
        return attempts, True, LOGIN_LOCKOUT_DURATION
    
    return attempts, False, 0


def clear_login_attempts(request, username=None):
    """Clear login attempts after successful login."""
    ip_address = get_client_ip(request)
    attempt_key = get_login_attempt_key(ip_address, username)
    lockout_key = get_lockout_key(ip_address, username)
    cache.delete(attempt_key)
    cache.delete(lockout_key)


def get_remaining_attempts(request, username=None):
    """Get the number of remaining login attempts."""
    ip_address = get_client_ip(request)
    attempt_key = get_login_attempt_key(ip_address, username)
    attempts = cache.get(attempt_key, 0)
    return max(0, MAX_LOGIN_ATTEMPTS - attempts)


# Custom throttle classes for DRF
class LoginRateThrottle(AnonRateThrottle):
    """Stricter rate limiting for login endpoint."""
    rate = '10/minute'  # Max 10 login requests per minute per IP
    scope = 'login'


class BurstRateThrottle(AnonRateThrottle):
    """Prevent burst attacks on anonymous endpoints."""
    rate = '30/minute'
    scope = 'burst'


class SustainedRateThrottle(UserRateThrottle):
    """Sustained rate limit for authenticated users."""
    rate = '1000/hour'
    scope = 'sustained'


class StrictAnonThrottle(AnonRateThrottle):
    """Very strict throttle for sensitive anonymous endpoints."""
    rate = '5/minute'
    scope = 'strict_anon'
