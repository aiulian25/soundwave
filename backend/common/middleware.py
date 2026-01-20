"""Custom middleware for debugging"""

import logging

logger = logging.getLogger(__name__)


class AuthDebugMiddleware:
    """Middleware to debug authentication issues"""
    
    def __init__(self, get_response):
        self.get_response = get_response
    
    def __call__(self, request):
        # Log before view processing
        if request.path.startswith('/api/channel/') and request.method == 'POST':
            logger.error(f"=== AUTH DEBUG ===")
            logger.error(f"Path: {request.path}")
            logger.error(f"Method: {request.method}")
            logger.error(f"User: {request.user}")
            logger.error(f"Is authenticated: {request.user.is_authenticated}")
            logger.error(f"Auth header: {request.META.get('HTTP_AUTHORIZATION', 'MISSING')}")
            logger.error(f"X-CSRFToken: {request.META.get('HTTP_X_CSRFTOKEN', 'MISSING')}")
            logger.error(f"Cookie: {request.META.get('HTTP_COOKIE', 'NO COOKIES')}")
            logger.error(f"=== END AUTH DEBUG ===")
        
        response = self.get_response(request)
        
        return response
