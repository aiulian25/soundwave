"""Passkey ceremonies, run through the real endpoints against a software authenticator.

Run: python manage.py test common.tests.test_passkeys --settings=config.settings_test
"""

import hashlib
import json
import secrets
import struct

import cbor2
import pyotp
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from django.core.cache import cache
from django.test import Client, TestCase, override_settings
from rest_framework.authtoken.models import Token
from webauthn.helpers import bytes_to_base64url

from common.rate_limiter import SENSITIVE_ACTION_MAX_ATTEMPTS
from user.models import Account, Passkey
from user.passkeys import PASSKEYS_PER_USER, resolve_relying_party
from user.two_factor import decrypt_secret, encrypt_secret, generate_totp_secret

ORIGIN = 'https://music.example.test'
RP_ID = 'music.example.test'
LOCAL_ORIGIN = 'http://localhost:8889'
PLAIN_HTTP_ORIGIN = 'http://music.example.test'
IP_ORIGIN = 'https://192.0.2.10'
FOREIGN_ORIGIN = 'https://evil.example.test'
ALLOWED = [ORIGIN, LOCAL_ORIGIN, PLAIN_HTTP_ORIGIN, IP_ORIGIN]

PASSWORD = 'Passkey-Owner_2026!'
FLAG_USER_PRESENT = 0x01
FLAG_USER_VERIFIED = 0x04
FLAG_ATTESTED_DATA = 0x40
ZERO_AAGUID = bytes(16)
SIGN_IN_RATE_PER_MINUTE = 20


class SoftwareAuthenticator:
    """Just enough of a platform authenticator, with switches for the ways one can misbehave."""

    def __init__(self, user_verified=True):
        self.private_key = ec.generate_private_key(ec.SECP256R1())
        self.credential_id = secrets.token_bytes(32)
        self.counter = 0
        self.user_verified = user_verified
        self.user_handle = None

    def _flags(self, extra=0):
        verified = FLAG_USER_VERIFIED if self.user_verified else 0
        return bytes([FLAG_USER_PRESENT | verified | extra])

    def _client_data(self, kind, challenge, origin):
        return json.dumps(
            {'type': kind, 'challenge': challenge, 'origin': origin, 'crossOrigin': False}
        ).encode()

    def _public_key_cose(self):
        numbers = self.private_key.public_key().public_numbers()
        return cbor2.dumps({
            1: 2, 3: -7, -1: 1,
            -2: numbers.x.to_bytes(32, 'big'),
            -3: numbers.y.to_bytes(32, 'big'),
        })

    def create(self, options, origin=ORIGIN):
        self.user_handle = options['user']['id']
        rp_hash = hashlib.sha256(options['rp']['id'].encode()).digest()
        attested = ZERO_AAGUID + struct.pack('>H', len(self.credential_id)) + self.credential_id + self._public_key_cose()
        authenticator_data = rp_hash + self._flags(FLAG_ATTESTED_DATA) + struct.pack('>I', self.counter) + attested
        attestation = cbor2.dumps({'fmt': 'none', 'attStmt': {}, 'authData': authenticator_data})
        encoded_id = bytes_to_base64url(self.credential_id)
        return {
            'id': encoded_id, 'rawId': encoded_id, 'type': 'public-key', 'clientExtensionResults': {},
            'response': {
                'clientDataJSON': bytes_to_base64url(self._client_data('webauthn.create', options['challenge'], origin)),
                'attestationObject': bytes_to_base64url(attestation),
            },
        }

    def get(self, options, origin=ORIGIN, rp_id=None):
        self.counter += 1
        rp_hash = hashlib.sha256((rp_id or options['rpId']).encode()).digest()
        authenticator_data = rp_hash + self._flags() + struct.pack('>I', self.counter)
        client_data = self._client_data('webauthn.get', options['challenge'], origin)
        signature = self.private_key.sign(
            authenticator_data + hashlib.sha256(client_data).digest(), ec.ECDSA(hashes.SHA256())
        )
        encoded_id = bytes_to_base64url(self.credential_id)
        return {
            'id': encoded_id, 'rawId': encoded_id, 'type': 'public-key',
            # Safari reports this extension without being asked; it must not cost a refusal.
            'clientExtensionResults': {'appid': False},
            'response': {
                'clientDataJSON': bytes_to_base64url(client_data),
                'authenticatorData': bytes_to_base64url(authenticator_data),
                'signature': bytes_to_base64url(signature),
                'userHandle': self.user_handle,
            },
        }


@override_settings(PASSKEY_ALLOWED_ORIGINS=ALLOWED)
class PasskeyTestCase(TestCase):
    def setUp(self):
        cache.clear()
        self.user = Account.objects.create_user('owner', 'owner@test.local', PASSWORD)
        self.session = Client()
        self.session.force_login(self.user)
        self.signed_out = Client()

    def post(self, client, path, body=None, origin=ORIGIN):
        return client.post(
            f'/api/user/passkeys/{path}', body or {}, content_type='application/json', HTTP_ORIGIN=origin
        )

    def begin_enrol(self, client=None, **step_up):
        return self.post(client or self.session, 'options/', {'password': PASSWORD, **step_up})

    def enrol(self, authenticator=None, name='Laptop'):
        authenticator = authenticator or SoftwareAuthenticator()
        options = self.begin_enrol().json()
        response = self.post(self.session, '', {'credential': authenticator.create(options), 'name': name})
        self.assertEqual(response.status_code, 201, response.content)
        return authenticator

    def sign_in_options(self, origin=ORIGIN):
        return self.post(self.signed_out, 'login/options/', origin=origin).json()

    def finish_sign_in(self, credential, client=None, origin=ORIGIN):
        return self.post(client or self.signed_out, 'login/', {'credential': credential}, origin=origin)

    def sign_in(self, authenticator):
        return self.finish_sign_in(authenticator.get(self.sign_in_options()))


class SignInTests(PasskeyTestCase):
    def test_passkey_signs_in_without_password_or_second_factor(self):
        self.user.two_factor_enabled = True
        self.user.two_factor_secret = encrypt_secret(generate_totp_secret())
        self.user.save()
        Passkey.objects.all().delete()
        authenticator = SoftwareAuthenticator()
        options = self.begin_enrol(two_factor_code=self._current_code()).json()
        self.post(self.session, '', {'credential': authenticator.create(options)})

        response = self.sign_in(authenticator)

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['user']['username'], 'owner')
        self.assertEqual(self.signed_out.get('/api/user/account/').status_code, 200)

    def _current_code(self):
        return pyotp.TOTP(decrypt_secret(self.user.two_factor_secret)).now()

    def test_sign_in_records_use_and_counter(self):
        authenticator = self.enrol()
        self.sign_in(authenticator)
        passkey = Passkey.objects.get()
        self.assertEqual(passkey.sign_count, authenticator.counter)
        self.assertIsNotNone(passkey.last_used_at)

    def test_forced_password_change_survives_passkey_sign_in(self):
        authenticator = self.enrol()
        Account.objects.filter(pk=self.user.pk).update(password_change_required=True)
        self.assertTrue(self.sign_in(authenticator).json()['user']['password_change_required'])

    def test_answer_cannot_be_replayed(self):
        authenticator = self.enrol()
        credential = authenticator.get(self.sign_in_options())
        self.assertEqual(self.finish_sign_in(credential).status_code, 200)
        self.assertEqual(self.finish_sign_in(credential, client=Client()).status_code, 401)

    def test_refused_answer_ends_the_ceremony(self):
        authenticator = self.enrol()
        options = self.sign_in_options()
        refused = self.finish_sign_in(authenticator.get(options, origin=FOREIGN_ORIGIN))
        self.assertEqual(refused.status_code, 401)
        self.assertEqual(self.finish_sign_in(authenticator.get(options)).status_code, 401)

    def test_inactive_account_is_refused(self):
        authenticator = self.enrol()
        Account.objects.filter(pk=self.user.pk).update(is_active=False)
        self.assertEqual(self.sign_in(authenticator).status_code, 401)
        self.assertEqual(self.signed_out.get('/api/user/account/').status_code, 401)

    def test_unverified_user_is_refused(self):
        authenticator = self.enrol()
        authenticator.user_verified = False
        self.assertEqual(self.sign_in(authenticator).status_code, 401)

    def test_foreign_client_data_origin_is_refused(self):
        authenticator = self.enrol()
        credential = authenticator.get(self.sign_in_options(), origin=FOREIGN_ORIGIN)
        self.assertEqual(self.finish_sign_in(credential).status_code, 401)

    def test_assertion_for_another_relying_party_is_refused(self):
        authenticator = self.enrol()
        credential = authenticator.get(self.sign_in_options(), rp_id='evil.example.test')
        self.assertEqual(self.finish_sign_in(credential).status_code, 401)

    def test_bad_signature_is_refused(self):
        authenticator = self.enrol()
        authenticator.private_key = ec.generate_private_key(ec.SECP256R1())
        self.assertEqual(self.sign_in(authenticator).status_code, 401)

    def test_cloned_authenticator_is_refused(self):
        authenticator = self.enrol()
        self.sign_in(authenticator)
        authenticator.counter -= 1
        self.assertEqual(self.sign_in(authenticator).status_code, 401)

    def test_user_handle_of_someone_else_is_refused(self):
        authenticator = self.enrol()
        authenticator.user_handle = bytes_to_base64url(b'999999')
        self.assertEqual(self.sign_in(authenticator).status_code, 401)

    def test_unknown_credential_is_refused(self):
        self.enrol()
        stranger = SoftwareAuthenticator()
        stranger.user_handle = bytes_to_base64url(b'1')
        self.assertEqual(self.sign_in(stranger).status_code, 401)

    def test_enrol_ceremony_cannot_answer_a_sign_in(self):
        authenticator = self.enrol()
        enrol_options = self.begin_enrol().json()
        credential = authenticator.get({**enrol_options, 'rpId': RP_ID})
        self.assertEqual(self.finish_sign_in(credential).status_code, 401)

    def test_sign_in_from_origin_outside_the_allow_list_is_refused(self):
        authenticator = self.enrol()
        credential = authenticator.get(self.sign_in_options(), origin=FOREIGN_ORIGIN)
        self.assertEqual(self.finish_sign_in(credential, origin=FOREIGN_ORIGIN).status_code, 409)

    def test_malformed_answers_are_refused_not_crashed(self):
        malformed = [
            {},
            {'id': 'x'},
            {'id': 123, 'rawId': [], 'response': 'nope'},
            {'id': 'AA', 'rawId': 'AA', 'type': 'public-key', 'response': {}},
            {'id': 'AA', 'rawId': 'AA', 'type': 'public-key', 'response': {
                'clientDataJSON': '!!!', 'authenticatorData': 'AA', 'signature': 'AA',
            }},
            {'id': 'AA', 'rawId': 'AA', 'type': 'public-key', 'response': {
                'clientDataJSON': bytes_to_base64url(b'not json'), 'authenticatorData': 'AA', 'signature': 'AA',
            }},
        ]
        for credential in malformed:
            with self.subTest(credential=credential):
                self.assertIn(self.finish_sign_in(credential).status_code, (400, 401))
                enrol = self.post(self.session, '', {'credential': credential})
                self.assertIn(enrol.status_code, (400, 401))

        for body in ([], 'text', {'credential': 'text'}):
            with self.subTest(body=body):
                response = self.signed_out.post(
                    '/api/user/passkeys/login/', json.dumps(body), content_type='application/json', HTTP_ORIGIN=ORIGIN
                )
                self.assertEqual(response.status_code, 400)


class EnrolTests(PasskeyTestCase):
    def test_enrol_stores_public_material_only_and_lists_it(self):
        self.enrol(name='  Laptop  ')
        listed = self.session.get('/api/user/passkeys/').json()
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]['name'], 'Laptop')
        self.assertEqual(listed[0]['rp_id'], RP_ID)
        self.assertEqual(set(listed[0]), {'id', 'name', 'rp_id', 'created_at', 'last_used_at'})

    def test_options_ask_for_a_discoverable_verified_credential(self):
        authenticator = self.enrol()
        options = self.begin_enrol().json()
        selection = options['authenticatorSelection']
        self.assertEqual(selection['residentKey'], 'required')
        self.assertEqual(selection['userVerification'], 'required')
        self.assertEqual(
            [item['id'] for item in options['excludeCredentials']],
            [bytes_to_base64url(authenticator.credential_id)],
        )

    def test_wrong_password_is_refused_then_locked(self):
        for _ in range(SENSITIVE_ACTION_MAX_ATTEMPTS - 1):
            response = self.post(self.session, 'options/', {'password': 'wrong'})
            self.assertEqual(response.status_code, 401)
        self.assertEqual(self.post(self.session, 'options/', {'password': 'wrong'}).status_code, 429)
        self.assertEqual(self.begin_enrol().status_code, 429)

    def test_second_factor_is_required_when_enabled(self):
        secret = generate_totp_secret()
        self.user.two_factor_enabled = True
        self.user.two_factor_secret = encrypt_secret(secret)
        self.user.save()
        self.assertEqual(self.begin_enrol().status_code, 401)
        self.assertEqual(self.begin_enrol(two_factor_code='000000').status_code, 401)
        self.assertEqual(self.begin_enrol(two_factor_code=pyotp.TOTP(secret).now()).status_code, 200)

    def test_no_ceremony_no_passkey(self):
        options = {'rp': {'id': RP_ID}, 'user': {'id': 'MQ'}, 'challenge': bytes_to_base64url(b'made-up-challenge-16')}
        credential = SoftwareAuthenticator().create(options)
        self.assertEqual(self.post(self.session, '', {'credential': credential}).status_code, 401)
        self.assertFalse(Passkey.objects.exists())

    def test_someone_elses_ceremony_cannot_be_finished(self):
        options = self.begin_enrol().json()
        other = Account.objects.create_user('other', 'other@test.local', PASSWORD)
        other_session = Client()
        other_session.force_login(other)
        credential = SoftwareAuthenticator().create(options)
        self.assertEqual(self.post(other_session, '', {'credential': credential}).status_code, 401)
        self.assertFalse(Passkey.objects.exists())

    def test_sign_in_ceremony_cannot_add_a_passkey(self):
        sign_in = self.sign_in_options()
        options = {'rp': {'id': RP_ID}, 'user': {'id': 'MQ'}, 'challenge': sign_in['challenge']}
        credential = SoftwareAuthenticator().create(options)
        self.assertEqual(self.post(self.session, '', {'credential': credential}).status_code, 401)

    def test_same_credential_cannot_be_added_twice(self):
        authenticator = self.enrol()
        credential = authenticator.create(self.begin_enrol().json())
        response = self.post(self.session, '', {'credential': credential})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'passkey_already_registered')

    def test_limit_per_user(self):
        for index in range(PASSKEYS_PER_USER):
            Passkey.objects.create(
                user=self.user, name='x', rp_id=RP_ID, credential_id=f'id{index}', public_key='k'
            )
        response = self.begin_enrol()
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()['code'], 'passkey_limit_reached')

    def test_oversized_name_is_refused(self):
        options = self.begin_enrol().json()
        body = {'credential': SoftwareAuthenticator().create(options), 'name': 'x' * (Passkey.NAME_MAX_LENGTH + 1)}
        self.assertEqual(self.post(self.session, '', body).status_code, 400)

    def test_management_needs_a_browser_session(self):
        token = Token.objects.create(user=self.user)
        token_client = Client(HTTP_AUTHORIZATION=f'Token {token.key}')
        self.assertIn(self.begin_enrol(client=token_client).status_code, (401, 403))
        self.assertIn(token_client.get('/api/user/passkeys/').status_code, (401, 403))

    def test_management_enforces_csrf(self):
        client = Client(enforce_csrf_checks=True)
        client.force_login(self.user)
        self.assertEqual(self.begin_enrol(client=client).status_code, 403)


class RemovalTests(PasskeyTestCase):
    def test_owner_removes_and_it_stops_working(self):
        authenticator = self.enrol()
        passkey = Passkey.objects.get()
        self.assertEqual(self.session.delete(f'/api/user/passkeys/{passkey.pk}/').status_code, 204)
        self.assertEqual(self.sign_in(authenticator).status_code, 401)

    def test_someone_elses_passkey_cannot_be_removed(self):
        self.enrol()
        other = Account.objects.create_user('other', 'other@test.local', PASSWORD)
        other_session = Client()
        other_session.force_login(other)
        passkey = Passkey.objects.get()
        self.assertEqual(other_session.delete(f'/api/user/passkeys/{passkey.pk}/').status_code, 404)
        self.assertTrue(Passkey.objects.filter(pk=passkey.pk).exists())

    def test_admin_two_factor_reset_evicts_passkeys(self):
        authenticator = self.enrol()
        admin = Account.objects.create_superuser('admin', 'admin@test.local', PASSWORD)
        admin_session = Client()
        admin_session.force_login(admin)
        response = admin_session.post(f'/api/user/admin/users/{self.user.pk}/reset_2fa/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.sign_in(authenticator).status_code, 401)


class AvailabilityTests(PasskeyTestCase):
    def availability(self, origin):
        return self.post(self.signed_out, 'availability/', origin=origin).json()

    def test_asking_does_not_spend_the_sign_in_budget(self):
        for _ in range(SIGN_IN_RATE_PER_MINUTE):
            self.availability(ORIGIN)
        self.assertEqual(self.post(self.signed_out, 'login/options/').status_code, 200)

    def test_unusable_addresses(self):
        for origin in (IP_ORIGIN, PLAIN_HTTP_ORIGIN, FOREIGN_ORIGIN):
            with self.subTest(origin=origin):
                self.assertEqual(self.availability(origin), {'usable': False, 'offered': False})

    def test_missing_origin_is_unusable(self):
        response = self.signed_out.post('/api/user/passkeys/availability/', content_type='application/json')
        self.assertEqual(response.json(), {'usable': False, 'offered': False})

    def test_offered_only_once_a_passkey_exists_for_this_address(self):
        self.assertEqual(self.availability(ORIGIN), {'usable': True, 'offered': False})
        self.enrol()
        self.assertEqual(self.availability(ORIGIN), {'usable': True, 'offered': True})
        self.assertEqual(self.availability(LOCAL_ORIGIN), {'usable': True, 'offered': False})

    def test_localhost_is_a_secure_context_and_its_own_relying_party(self):
        relying_party = resolve_relying_party(LOCAL_ORIGIN)
        self.assertEqual((relying_party.id, relying_party.origin), ('localhost', LOCAL_ORIGIN))

    def test_passkey_only_answers_on_its_own_address(self):
        authenticator = self.enrol()
        options = self.post(self.signed_out, 'login/options/', origin=LOCAL_ORIGIN).json()
        credential = authenticator.get(options, origin=LOCAL_ORIGIN)
        self.assertEqual(self.finish_sign_in(credential, origin=LOCAL_ORIGIN).status_code, 401)
