"""Custom authentication classes"""

from rest_framework.authentication import TokenAuthentication


class CsrfExemptTokenAuthentication(TokenAuthentication):
    """
    Token authentication that doesn't require CSRF tokens.
    This is safe because tokens are stored in localStorage and sent via headers,
    not cookies, so they're not vulnerable to CSRF attacks.
    """
    def enforce_csrf(self, request):
        return  # To not perform the csrf check
