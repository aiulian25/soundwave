"""Passkey API views"""

import logging

from django.contrib.auth import login
from rest_framework import status
from rest_framework.authentication import SessionAuthentication
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from common.rate_limiter import (
    BurstRateThrottle,
    PasskeyRateThrottle,
    SENSITIVE_ACTION_MAX_ATTEMPTS,
    clear_sensitive_action_attempts,
    get_client_ip,
    is_sensitive_action_locked,
    record_sensitive_action_failure,
)
from common.views import ApiBaseView
from user import passkeys
from user.serializers import (
    AccountSerializer,
    PasskeyCredentialSerializer,
    PasskeySerializer,
    PasskeyStepUpSerializer,
)

audit_log = logging.getLogger('security.audit')

ORIGIN_HEADER = 'Origin'
ENROL_ACTION = 'passkey_enrol'
ERROR_STEP_UP_FAILED = 'passkey_step_up_failed'
ERROR_LOCKED = 'passkey_locked'
ERROR_INVALID_REQUEST = 'passkey_invalid_request'

REFUSAL_STATUS = {
    passkeys.ERROR_UNAVAILABLE: status.HTTP_409_CONFLICT,
    passkeys.ERROR_REFUSED: status.HTTP_401_UNAUTHORIZED,
    passkeys.ERROR_LIMIT_REACHED: status.HTTP_409_CONFLICT,
    passkeys.ERROR_ALREADY_REGISTERED: status.HTTP_409_CONFLICT,
}


def _browser_origin(request):
    return request.headers.get(ORIGIN_HEADER)


def _refused(error):
    return Response({'error': error.code, 'code': error.code}, status=REFUSAL_STATUS[error.code])


def _invalid_request():
    return Response(
        {'error': ERROR_INVALID_REQUEST, 'code': ERROR_INVALID_REQUEST},
        status=status.HTTP_400_BAD_REQUEST,
    )


def _locked(remaining_seconds):
    return Response(
        {'error': ERROR_LOCKED, 'code': ERROR_LOCKED, 'locked': True, 'remaining_seconds': remaining_seconds},
        status=status.HTTP_429_TOO_MANY_REQUESTS,
    )


class PasskeySignInBaseView(APIView):
    """Reachable signed out; the origin allow list stands in for the CSRF check."""
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [PasskeyRateThrottle]


class PasskeyAvailabilityView(PasskeySignInBaseView):
    """POST, because browsers only send the Origin header that decides this on non-GET requests.

    Every login page load asks, so it must not spend the budget of actual sign-ins.
    """
    throttle_classes = [BurstRateThrottle]

    def post(self, request):
        relying_party = passkeys.resolve_relying_party(_browser_origin(request))
        if relying_party is None:
            return Response({'usable': False, 'offered': False})
        return Response({'usable': True, 'offered': passkeys.is_offered(relying_party)})


class PasskeyLoginOptionsView(PasskeySignInBaseView):
    def post(self, request):
        try:
            relying_party = passkeys.require_relying_party(_browser_origin(request))
        except passkeys.PasskeyError as error:
            return _refused(error)
        return Response(passkeys.authentication_options(relying_party))


class PasskeyLoginView(PasskeySignInBaseView):
    def post(self, request):
        serializer = PasskeyCredentialSerializer(data=request.data)
        if not serializer.is_valid():
            return _invalid_request()

        client_ip = get_client_ip(request)
        try:
            relying_party = passkeys.require_relying_party(_browser_origin(request))
            user = passkeys.authenticate(relying_party, serializer.validated_data['credential'])
        except passkeys.PasskeyError as error:
            audit_log.warning(
                "Failed passkey login ip=%s reason=%s cause=%s",
                client_ip, error.code, type(error.__cause__).__name__,
            )
            return _refused(error)

        audit_log.info("Successful passkey login user=%s ip=%s", user.username, client_ip)
        login(request, user)
        return Response({'session_authenticated': True, 'user': AccountSerializer(user).data})


class PasskeyManagementBaseView(ApiBaseView):
    """Signed-in browser sessions only: a token or API key must never manage a way to sign in."""
    authentication_classes = [SessionAuthentication]


class PasskeyEnrolOptionsView(PasskeyManagementBaseView):
    """Begin adding a passkey. A session left open must not be enough to plant one."""

    def post(self, request):
        user = request.user
        locked, remaining_seconds = is_sensitive_action_locked(user.id, ENROL_ACTION)
        if locked:
            return _locked(remaining_seconds)

        serializer = PasskeyStepUpSerializer(data=request.data)
        if not serializer.is_valid():
            return _invalid_request()

        try:
            relying_party = passkeys.require_relying_party(_browser_origin(request))
        except passkeys.PasskeyError as error:
            return _refused(error)

        confirmed = passkeys.confirm_identity(
            user,
            serializer.validated_data['password'],
            serializer.validated_data.get('two_factor_code', ''),
        )
        if not confirmed:
            return self._step_up_failed(request, user)

        clear_sensitive_action_attempts(user.id, ENROL_ACTION)
        try:
            return Response(passkeys.registration_options(user, relying_party))
        except passkeys.PasskeyError as error:
            return _refused(error)

    def _step_up_failed(self, request, user):
        audit_log.warning("Failed passkey step-up user=%s ip=%s", user.username, get_client_ip(request))
        attempts, is_now_locked, lockout_duration = record_sensitive_action_failure(user.id, ENROL_ACTION)
        if is_now_locked:
            return _locked(lockout_duration)
        return Response(
            {
                'error': ERROR_STEP_UP_FAILED,
                'code': ERROR_STEP_UP_FAILED,
                'remaining_attempts': SENSITIVE_ACTION_MAX_ATTEMPTS - attempts,
            },
            status=status.HTTP_401_UNAUTHORIZED,
        )


class PasskeyListView(PasskeyManagementBaseView):
    def get(self, request):
        return Response(PasskeySerializer(request.user.passkeys.all(), many=True).data)

    def post(self, request):
        """Finish adding a passkey; only a ceremony that passed the step-up can complete."""
        serializer = PasskeyCredentialSerializer(data=request.data)
        if not serializer.is_valid():
            return _invalid_request()

        try:
            relying_party = passkeys.require_relying_party(_browser_origin(request))
            passkey = passkeys.register(
                request.user,
                relying_party,
                serializer.validated_data['credential'],
                serializer.validated_data.get('name', ''),
            )
        except passkeys.PasskeyError as error:
            return _refused(error)

        audit_log.info("Passkey added user=%s ip=%s", request.user.username, get_client_ip(request))
        return Response(PasskeySerializer(passkey).data, status=status.HTTP_201_CREATED)


class PasskeyDetailView(PasskeyManagementBaseView):
    def delete(self, request, passkey_id):
        deleted, _ = request.user.passkeys.filter(pk=passkey_id).delete()
        if not deleted:
            return Response(status=status.HTTP_404_NOT_FOUND)
        audit_log.info("Passkey removed user=%s ip=%s", request.user.username, get_client_ip(request))
        return Response(status=status.HTTP_204_NO_CONTENT)
