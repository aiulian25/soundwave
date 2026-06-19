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
    """Resolve the client IP for rate-limiting / lockout keys.

    Security (APP-08): ``X-Forwarded-For`` is client-controlled and can be spoofed
    to evade per-IP lockout/throttle. It is therefore only trusted when the
    deployment declares how many trusted proxies sit in front of the app via the
    ``NUM_PROXIES`` setting (same concept as DRF's NUM_PROXIES and Django's
    SECURE_PROXY_SSL_HEADER):

      - NUM_PROXIES unset (None): backward-compatible default — use the first XFF
        entry if present, else REMOTE_ADDR.
      - NUM_PROXIES = 0: ignore XFF entirely, use REMOTE_ADDR.
      - NUM_PROXIES = N: take the Nth entry from the right of XFF — the address our
        own trusted proxy observed, which the client cannot forge.

    Behind a reverse proxy, set NUM_PROXIES to the number of proxies so real client
    IPs are used and spoofing is prevented.
    """
    remote_addr = request.META.get('REMOTE_ADDR', '')
    xff = request.META.get('HTTP_X_FORWARDED_FOR', '')
    num_proxies = getattr(settings, 'NUM_PROXIES', None)

    if num_proxies is not None:
        if num_proxies == 0 or not xff:
            return remote_addr
        addrs = [addr.strip() for addr in xff.split(',') if addr.strip()]
        if not addrs:
            return remote_addr
        return addrs[-min(num_proxies, len(addrs))]

    # Default (no trusted-proxy configuration): preserve prior behavior.
    if xff:
        return xff.split(',')[0].strip()
    return remote_addr


def get_login_attempt_key(ip_address, username=None):
    """Generate cache key for login attempts."""
    # Create a composite key using IP and optionally username
    identifier = f"{ip_address}"
    if username:
        identifier = f"{ip_address}:{username}"
    key_hash = hashlib.sha256(identifier.encode()).hexdigest()
    return f"login_attempts:{key_hash}"


def get_lockout_key(ip_address, username=None):
    """Generate cache key for lockout status."""
    identifier = f"{ip_address}"
    if username:
        identifier = f"{ip_address}:{username}"
    key_hash = hashlib.sha256(identifier.encode()).hexdigest()
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
    rate = '10000/hour'  # Increased from 1000 to prevent 429 on page loads
    scope = 'sustained'


class StrictAnonThrottle(AnonRateThrottle):
    """Very strict throttle for sensitive anonymous endpoints."""
    rate = '5/minute'
    scope = 'strict_anon'


# Sensitive action rate limiting for authenticated users
SENSITIVE_ACTION_MAX_ATTEMPTS = 5
SENSITIVE_ACTION_LOCKOUT_DURATION = 30 * 60  # 30 minutes


def get_sensitive_action_key(user_id, action_type):
    """Generate cache key for sensitive action attempts."""
    return f"sensitive_action:{action_type}:{user_id}"


def get_sensitive_action_lockout_key(user_id, action_type):
    """Generate cache key for sensitive action lockout."""
    return f"sensitive_lockout:{action_type}:{user_id}"


def is_sensitive_action_locked(user_id, action_type):
    """
    Check if user is locked out from a sensitive action.
    Returns (is_locked, remaining_seconds).
    """
    lockout_key = get_sensitive_action_lockout_key(user_id, action_type)
    lockout_until = cache.get(lockout_key)
    
    if lockout_until:
        now = datetime.now()
        if now < lockout_until:
            remaining = (lockout_until - now).total_seconds()
            return True, int(remaining)
        else:
            cache.delete(lockout_key)
    
    return False, 0


def record_sensitive_action_failure(user_id, action_type):
    """
    Record a failed sensitive action attempt.
    Returns (attempt_count, is_now_locked, lockout_duration).
    """
    attempt_key = get_sensitive_action_key(user_id, action_type)
    lockout_key = get_sensitive_action_lockout_key(user_id, action_type)
    
    attempts = cache.get(attempt_key, 0) + 1
    cache.set(attempt_key, attempts, SENSITIVE_ACTION_LOCKOUT_DURATION)
    
    if attempts >= SENSITIVE_ACTION_MAX_ATTEMPTS:
        lockout_until = datetime.now() + timedelta(seconds=SENSITIVE_ACTION_LOCKOUT_DURATION)
        cache.set(lockout_key, lockout_until, SENSITIVE_ACTION_LOCKOUT_DURATION)
        cache.delete(attempt_key)
        return attempts, True, SENSITIVE_ACTION_LOCKOUT_DURATION
    
    return attempts, False, 0


def clear_sensitive_action_attempts(user_id, action_type):
    """Clear sensitive action attempts after success."""
    attempt_key = get_sensitive_action_key(user_id, action_type)
    lockout_key = get_sensitive_action_lockout_key(user_id, action_type)
    cache.delete(attempt_key)
    cache.delete(lockout_key)


def get_sensitive_action_remaining_attempts(user_id, action_type):
    """Get remaining attempts for a sensitive action."""
    attempt_key = get_sensitive_action_key(user_id, action_type)
    attempts = cache.get(attempt_key, 0)
    return max(0, SENSITIVE_ACTION_MAX_ATTEMPTS - attempts)
