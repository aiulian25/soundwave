"""Custom middleware for debugging"""

import logging
import os

logger = logging.getLogger(__name__)

# Only enable auth debugging if explicitly set (NEVER in production)
AUTH_DEBUG_ENABLED = os.environ.get('AUTH_DEBUG', 'false').lower() == 'true'


class AuthDebugMiddleware:
    """Middleware to debug authentication issues - ONLY for development"""
    
    def __init__(self, get_response):
        self.get_response = get_response
    
    def __call__(self, request):
        # Only log if explicitly enabled via environment variable
        # NEVER enable in production - logs sensitive authentication data
        if AUTH_DEBUG_ENABLED and request.path.startswith('/api/channel/') and request.method == 'POST':
            logger.debug(f"=== AUTH DEBUG ===")
            logger.debug(f"Path: {request.path}")
            logger.debug(f"Method: {request.method}")
            logger.debug(f"User: {request.user}")
            logger.debug(f"Is authenticated: {request.user.is_authenticated}")
            # Don't log actual token/cookie values even in debug mode
            logger.debug(f"Has auth header: {bool(request.META.get('HTTP_AUTHORIZATION'))}")
            logger.debug(f"Has CSRF token: {bool(request.META.get('HTTP_X_CSRFTOKEN'))}")
            logger.debug(f"=== END AUTH DEBUG ===")
        
        response = self.get_response(request)
        
        return response
