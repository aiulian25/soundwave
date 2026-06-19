"""Email-change verification (APP-10).

A new email address is only applied after the user follows a signed, short-lived
confirmation link sent to that address. Uses django.core.signing (HMAC over the
payload with SECRET_KEY) — no extra storage beyond Account.pending_email.
"""

from urllib.parse import urlparse

from django.conf import settings
from django.core import signing
from django.core.mail import send_mail

EMAIL_CHANGE_SALT = 'soundwave.email-change.v1'


# Localized plain-text email templates (subject, body). Body uses {username} and {link}.
_EMAIL_TEMPLATES = {
    'en': (
        'Confirm your new SoundWave email address',
        'Hi {username},\n\n'
        'We received a request to change your SoundWave account email to this address.\n'
        'Confirm the change by opening this link (valid for {minutes} minutes):\n\n'
        '{link}\n\n'
        'If you did not request this, you can ignore this email — your address will not change.\n',
    ),
    'ro': (
        'Confirma noua adresa de email SoundWave',
        'Salut {username},\n\n'
        'Am primit o solicitare de schimbare a adresei de email a contului tau SoundWave catre aceasta adresa.\n'
        'Confirma schimbarea deschizand acest link (valabil {minutes} minute):\n\n'
        '{link}\n\n'
        'Daca nu ai facut tu aceasta solicitare, poti ignora acest email — adresa nu se va schimba.\n',
    ),
}


def make_email_change_token(user, new_email):
    """Create a signed, expiring token authorizing user -> new_email."""
    return signing.dumps({'uid': user.pk, 'email': new_email}, salt=EMAIL_CHANGE_SALT, compress=True)


def load_email_change_token(token):
    """Return the token payload dict, or raise signing.BadSignature/SignatureExpired."""
    ttl = int(getattr(settings, 'EMAIL_CHANGE_TOKEN_TTL', 30 * 60))
    return signing.loads(token, salt=EMAIL_CHANGE_SALT, max_age=ttl)


def build_confirm_link(token):
    """Build the SPA confirmation URL from SW_HOST."""
    base = (getattr(settings, 'SW_HOST', '') or '').strip().rstrip('/')
    parsed = urlparse(base)
    if not parsed.scheme or not parsed.netloc:
        base = 'http://localhost:8889'
    return f"{base}/confirm-email?token={token}"


def send_email_change_confirmation(user, new_email, language='en'):
    """Email a confirmation link to the prospective new address.

    Returns True on success. Raises on transport failure so the caller can revert
    the pending change.
    """
    token = make_email_change_token(user, new_email)
    link = build_confirm_link(token)
    minutes = max(1, int(getattr(settings, 'EMAIL_CHANGE_TOKEN_TTL', 30 * 60)) // 60)

    subject, body = _EMAIL_TEMPLATES.get(language, _EMAIL_TEMPLATES['en'])
    send_mail(
        subject,
        body.format(username=user.username, link=link, minutes=minutes),
        getattr(settings, 'DEFAULT_FROM_EMAIL', None),
        [new_email],
        fail_silently=False,
    )
    return True
