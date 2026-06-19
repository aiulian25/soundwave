"""Shared password-policy enforcement (APP-07).

Runs Django's configured AUTH_PASSWORD_VALIDATORS and returns both the
human-readable messages and stable validator *codes*, so the SPA can render a
localized message regardless of the server's language.

Codes produced by the default validators:
    password_too_short        (MinimumLengthValidator)
    password_too_common       (CommonPasswordValidator)
    password_entirely_numeric (NumericPasswordValidator)
    password_too_similar      (UserAttributeSimilarityValidator)
"""

from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError


def check_password_strength(password, user=None):
    """Validate a password against the configured validators.

    Returns ``(messages, codes)`` listing each failure, or ``(None, None)`` when
    the password is acceptable.
    """
    try:
        validate_password(password, user=user)
    except ValidationError as exc:
        messages = list(exc.messages)
        codes = [getattr(err, 'code', 'password_invalid') for err in exc.error_list]
        return messages, codes
    return None, None
