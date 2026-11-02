"""Passkey (WebAuthn) sign-in: relying party rules, ceremonies and credential storage."""

import ipaddress
import json
from dataclasses import dataclass
from urllib.parse import urlparse

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import (
    base64url_to_bytes,
    bytes_to_base64url,
    parse_authentication_credential_json,
    parse_client_data_json,
    parse_registration_credential_json,
)
from webauthn.helpers.exceptions import WebAuthnException
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from user.models import Passkey
from user.two_factor import decrypt_secret, verify_and_consume_backup_code, verify_totp

RELYING_PARTY_NAME = 'SoundWave'
SECURE_SCHEME = 'https'
LOCALHOST = 'localhost'
DEFAULT_PASSKEY_NAME = 'Passkey'
PASSKEYS_PER_USER = 10

CEREMONY_TIMEOUT_MILLISECONDS = 300_000
CEREMONY_TIMEOUT_SECONDS = CEREMONY_TIMEOUT_MILLISECONDS // 1000
CEREMONY_KEY_PREFIX = 'passkey_ceremony:'
PURPOSE_ENROL = 'enrol'
PURPOSE_SIGN_IN = 'sign_in'

ERROR_UNAVAILABLE = 'passkey_unavailable'
ERROR_REFUSED = 'passkey_refused'
ERROR_LIMIT_REACHED = 'passkey_limit_reached'
ERROR_ALREADY_REGISTERED = 'passkey_already_registered'


class PasskeyError(Exception):
    """A ceremony was refused; `code` is a stable value the interface translates."""

    def __init__(self, code):
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class RelyingParty:
    id: str
    origin: str


def _is_ip_address(hostname):
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        return False
    return True


def resolve_relying_party(origin):
    """The relying party for a browser origin, or None where passkeys cannot work.

    WebAuthn needs a secure context and a hostname: browsers refuse bare IP addresses
    as a relying party, and plain HTTP anywhere but localhost.
    """
    if origin not in settings.PASSKEY_ALLOWED_ORIGINS:
        return None
    parsed = urlparse(origin)
    hostname = parsed.hostname
    if not hostname or _is_ip_address(hostname):
        return None
    if parsed.scheme != SECURE_SCHEME and hostname != LOCALHOST:
        return None
    return RelyingParty(id=hostname, origin=origin)


def require_relying_party(origin):
    relying_party = resolve_relying_party(origin)
    if relying_party is None:
        raise PasskeyError(ERROR_UNAVAILABLE)
    return relying_party


def is_offered(relying_party):
    """Whether signing in here could succeed, so the button is not shown to no end."""
    return Passkey.objects.filter(rp_id=relying_party.id).exists()


def confirm_identity(user, password, two_factor_code=''):
    """Password plus the second factor when enabled, each new passkey being a lasting way in."""
    if not user.check_password(password):
        return False
    if not user.two_factor_enabled:
        return True
    if user.two_factor_secret and verify_totp(decrypt_secret(user.two_factor_secret), two_factor_code):
        return True
    if not verify_and_consume_backup_code(user, two_factor_code):
        return False
    user.save(update_fields=['backup_codes'])
    return True


def _ceremony_key(challenge):
    return f'{CEREMONY_KEY_PREFIX}{challenge}'


def _remember_ceremony(challenge, purpose, user_id=None):
    record = {'purpose': purpose, 'user_id': user_id}
    cache.set(_ceremony_key(bytes_to_base64url(challenge)), record, CEREMONY_TIMEOUT_SECONDS)


def _take_ceremony(client_data_json, purpose, user_id=None):
    """Consume the ceremony an answer refers to and return its challenge.

    It is removed before anything else is checked, so a refused answer also ends it, and
    only the caller whose delete removed the key wins a concurrent replay.
    """
    challenge = bytes_to_base64url(parse_client_data_json(client_data_json).challenge)
    key = _ceremony_key(challenge)
    record = cache.get(key)
    if record is None or not cache.delete(key):
        raise PasskeyError(ERROR_REFUSED)
    if record != {'purpose': purpose, 'user_id': user_id}:
        raise PasskeyError(ERROR_REFUSED)
    return base64url_to_bytes(challenge)


def _user_handle(user):
    return str(user.pk).encode()


def registration_options(user, relying_party):
    if user.passkeys.count() >= PASSKEYS_PER_USER:
        raise PasskeyError(ERROR_LIMIT_REACHED)
    existing_ids = user.passkeys.filter(rp_id=relying_party.id).values_list('credential_id', flat=True)
    options = generate_registration_options(
        rp_id=relying_party.id,
        rp_name=RELYING_PARTY_NAME,
        user_id=_user_handle(user),
        user_name=user.username,
        timeout=CEREMONY_TIMEOUT_MILLISECONDS,
        exclude_credentials=[
            PublicKeyCredentialDescriptor(id=base64url_to_bytes(credential_id)) for credential_id in existing_ids
        ],
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED,
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
    )
    _remember_ceremony(options.challenge, PURPOSE_ENROL, user.pk)
    return json.loads(options_to_json(options))


def register(user, relying_party, credential, name=''):
    try:
        parsed = parse_registration_credential_json(credential)
        challenge = _take_ceremony(parsed.response.client_data_json, PURPOSE_ENROL, user.pk)
        verified = verify_registration_response(
            credential=parsed,
            expected_challenge=challenge,
            expected_rp_id=relying_party.id,
            expected_origin=relying_party.origin,
            require_user_verification=True,
        )
    except WebAuthnException as error:
        raise PasskeyError(ERROR_REFUSED) from error

    credential_id = bytes_to_base64url(verified.credential_id)
    if len(credential_id) > Passkey.CREDENTIAL_ID_MAX_LENGTH:
        raise PasskeyError(ERROR_REFUSED)
    if Passkey.objects.filter(credential_id=credential_id).exists():
        raise PasskeyError(ERROR_ALREADY_REGISTERED)
    return Passkey.objects.create(
        user=user,
        name=name.strip() or DEFAULT_PASSKEY_NAME,
        rp_id=relying_party.id,
        credential_id=credential_id,
        public_key=bytes_to_base64url(verified.credential_public_key),
        sign_count=verified.sign_count,
    )


def authentication_options(relying_party):
    options = generate_authentication_options(
        rp_id=relying_party.id,
        timeout=CEREMONY_TIMEOUT_MILLISECONDS,
        user_verification=UserVerificationRequirement.REQUIRED,
    )
    _remember_ceremony(options.challenge, PURPOSE_SIGN_IN)
    return json.loads(options_to_json(options))


def authenticate(relying_party, credential):
    """The active account a sign-in answer proves, or PasskeyError with the same code for every refusal."""
    try:
        parsed = parse_authentication_credential_json(credential)
        challenge = _take_ceremony(parsed.response.client_data_json, PURPOSE_SIGN_IN)
        passkey = (
            Passkey.objects.select_related('user')
            .filter(credential_id=parsed.id, rp_id=relying_party.id)
            .first()
        )
        if passkey is None:
            raise PasskeyError(ERROR_REFUSED)
        verified = verify_authentication_response(
            credential=parsed,
            expected_challenge=challenge,
            expected_rp_id=relying_party.id,
            expected_origin=relying_party.origin,
            credential_public_key=base64url_to_bytes(passkey.public_key),
            credential_current_sign_count=passkey.sign_count,
            require_user_verification=True,
        )
    except WebAuthnException as error:
        raise PasskeyError(ERROR_REFUSED) from error

    user = passkey.user
    handle_matches = not parsed.response.user_handle or parsed.response.user_handle == _user_handle(user)
    if not handle_matches or not user.is_active:
        raise PasskeyError(ERROR_REFUSED)

    passkey.sign_count = verified.new_sign_count
    passkey.last_used_at = timezone.now()
    passkey.save(update_fields=['sign_count', 'last_used_at'])
    return user
