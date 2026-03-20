"""Security headers middleware for defense-in-depth."""

from django.conf import settings


class SecurityHeadersMiddleware:
    """
    Adds security headers to all responses.
    These supplement Django's built-in SecurityMiddleware.
    """

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        response = self.get_response(request)

        # Content Security Policy — restrict resource loading
        # Allow self + inline styles (needed for UI frameworks) + data URIs for images
        if 'Content-Security-Policy' not in response:
            csp_parts = [
                "default-src 'self'",
                "script-src 'self'",
                "style-src 'self' 'unsafe-inline'",
                "img-src 'self' data: blob: https://i.ytimg.com https://i3.ytimg.com https://i9.ytimg.com https://img.youtube.com https://coverartarchive.org https://assets.fanart.tv https://lastfm.freetls.fastly.net",
                "font-src 'self' data:",
                "connect-src 'self'",
                "media-src 'self' blob:",
                "worker-src 'self'",
                "manifest-src 'self'",
                "frame-ancestors 'none'",
                "base-uri 'self'",
                "form-action 'self'",
            ]
            response['Content-Security-Policy'] = '; '.join(csp_parts)

        # Referrer-Policy — don't leak full URL to third parties
        if 'Referrer-Policy' not in response:
            response['Referrer-Policy'] = 'strict-origin-when-cross-origin'

        # Permissions-Policy — disable browser features we don't use
        if 'Permissions-Policy' not in response:
            response['Permissions-Policy'] = (
                'camera=(), geolocation=(), microphone=(), '
                'payment=(), usb=(), interest-cohort=()'
            )

        # Cross-Origin-Embedder-Policy and Cross-Origin-Resource-Policy
        # Only set on non-media responses to avoid breaking audio/image loading
        is_media_or_static = (
            request.path.startswith('/media/')
            or request.path.startswith('/assets/')
            or request.path.startswith('/img/')
            or request.path.startswith('/avatars/')
        )
        if not is_media_or_static:
            if 'Cross-Origin-Resource-Policy' not in response:
                response['Cross-Origin-Resource-Policy'] = 'same-origin'

        return response
