"""Custom authentication classes"""

from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
from common.expiring_token import ExpiringTokenAuthentication


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


class APIKeyAuthentication(BaseAuthentication):
    """
    API Key authentication for widget/external access (TubeArchivist-style).
    
    Supports multiple authentication methods:
    1. Header: Authorization: Token <key> (TubeArchivist/Homepage format)
    2. Header: Authorization: ApiKey <key>
    3. Query parameter: ?key=<api_key>
    
    This mimics TubeArchivist's widget API authentication pattern.
    """
    
    def authenticate(self, request):
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        key = None
        
        # Try Token header (TubeArchivist/Homepage format)
        if auth_header.startswith('Token '):
            key = auth_header[6:]
        # Try ApiKey header
        elif auth_header.startswith('ApiKey '):
            key = auth_header[7:]
        else:
            # Try query parameter (for widget integrations)
            key = request.query_params.get('key', '')
        
        if not key:
            return None
        
        # Validate the key
        from user.models import APIKey
        api_key = APIKey.validate_key(key)
        
        if api_key is None:
            raise AuthenticationFailed('Invalid or expired API key')
        
        # Store the API key object on the request for permission checking
        request.api_key = api_key
        
        return (api_key.user, api_key)
    
    def authenticate_header(self, request):
        return 'Token'

