"""
HTTP Range request support for media file streaming
Enables seeking in audio/video files by supporting partial content delivery

Security Features:
- Authentication required for all media access (session, header token, or query token)
- Path normalization to prevent directory traversal
- File validation
- Content-Type header enforcement
- Symlink attack prevention
"""

import os
import re
import logging
from django.conf import settings
from django.core.cache import cache
from django.http import StreamingHttpResponse, HttpResponse, Http404, HttpResponseForbidden
from django.utils.http import http_date
from pathlib import Path
from rest_framework.authtoken.models import Token
from common.expiring_token import is_token_expired
from common.rate_limiter import get_client_ip

logger = logging.getLogger(__name__)


def authenticate_media_request(request):
    """
    Authenticate a media request using multiple methods:
    1. Django session (cookies - already authenticated via session middleware)
    2. Authorization header (Token xxx)
    3. Query parameter (?token=xxx) - for browser audio/video elements
    
    Returns:
        (user, None) if authenticated
        (None, error_message) if not authenticated
    """
    # Method 1: Session authentication (already handled by SessionMiddleware)
    if request.user.is_authenticated:
        return (request.user, None)
    
    # Method 2: Authorization header
    auth_header = request.META.get('HTTP_AUTHORIZATION', '')
    if auth_header.startswith('Token '):
        token_key = auth_header[6:]
        try:
            token = Token.objects.select_related('user').get(key=token_key)
            if not is_token_expired(token):
                return (token.user, None)
            else:
                return (None, "Token expired")
        except Token.DoesNotExist:
            return (None, "Invalid token")
    
    # Method 3: Query parameter (for browser audio/video elements)
    token_key = request.GET.get('token', '')
    if token_key:
        try:
            token = Token.objects.select_related('user').get(key=token_key)
            if not is_token_expired(token):
                return (token.user, None)
            else:
                return (None, "Token expired")
        except Token.DoesNotExist:
            return (None, "Invalid token")
    
    return (None, "Authentication required")


def range_file_iterator(file_obj, offset=0, chunk_size=8192, length=None):
    """
    Iterator for serving file in chunks with range support
    Efficiently streams large files without loading entire file into memory
    
    Args:
        file_obj: Open file object
        offset: Starting byte position
        chunk_size: Size of each chunk to read
        length: Total bytes to read (None = read to end)
    """
    file_obj.seek(offset)
    remaining = length
    while True:
        if remaining is not None:
            chunk_size = min(chunk_size, remaining)
            if chunk_size == 0:
                break
        data = file_obj.read(chunk_size)
        if not data:
            break
        if remaining is not None:
            remaining -= len(data)
        yield data


def stream_file_iterator(file_obj, offset=0, chunk_size=8192, length=None, on_close=None):
    """Iterate file chunks and always run cleanup callback when streaming ends."""
    try:
        yield from range_file_iterator(file_obj, offset=offset, chunk_size=chunk_size, length=length)
    finally:
        try:
            file_obj.close()
        except Exception:
            pass
        if on_close:
            try:
                on_close()
            except Exception:
                pass


def _acquire_media_stream_slot(request, user):
    """Acquire a concurrent media stream slot for the request scope."""
    if not getattr(settings, 'MEDIA_RATE_LIMIT_ENABLED', True):
        return None, None

    if user and getattr(user, 'is_authenticated', False):
        limit = max(1, int(getattr(settings, 'MEDIA_MAX_CONCURRENT_STREAMS_USER', 20)))
        counter_key = f"media_stream_active:user:{user.pk}"
    else:
        client_ip = get_client_ip(request) or 'unknown'
        limit = max(1, int(getattr(settings, 'MEDIA_MAX_CONCURRENT_STREAMS_IP', 30)))
        counter_key = f"media_stream_active:ip:{client_ip}"

    ttl = max(30, int(getattr(settings, 'MEDIA_STREAM_SLOT_TTL', 300)))

    try:
        cache.add(counter_key, 0, timeout=ttl)
        try:
            active = cache.incr(counter_key)
        except ValueError:
            cache.set(counter_key, 1, timeout=ttl)
            active = 1

        if hasattr(cache, 'touch'):
            cache.touch(counter_key, ttl)

        if active > limit:
            try:
                cache.decr(counter_key)
            except ValueError:
                cache.set(counter_key, 0, timeout=ttl)
            return None, f"Too many concurrent media streams (limit: {limit})"

        return counter_key, None
    except Exception as exc:
        # Fail open if cache is unavailable so playback remains usable.
        logger.warning("Media rate-limit backend unavailable; allowing request: %s", exc)
        return None, None


def _release_media_stream_slot(counter_key):
    """Release a previously acquired concurrent media stream slot."""
    if not counter_key:
        return

    try:
        cache.decr(counter_key)
    except ValueError:
        cache.set(counter_key, 0, timeout=max(30, int(getattr(settings, 'MEDIA_STREAM_SLOT_TTL', 300))))
    except Exception:
        pass


def serve_media_with_range(request, path, document_root):
    """
    Serve static media files with HTTP Range request support
    This enables seeking in audio/video files
    
    Security considerations:
    1. Authentication: REQUIRES authenticated user
    2. Path Traversal: Prevents access to files outside document_root
    3. File Validation: Only serves existing files within allowed directory
    4. No Directory Listing: Returns 404 for directories
    
    Args:
        request: Django request object (user must be authenticated)
        path: Relative path to file (validated for security)
        document_root: Absolute path to media root directory
        
    Returns:
        StreamingHttpResponse with proper Range headers for seeking support
        
    HTTP Status Codes:
        200: Full content served
        206: Partial content served (range request)
        403: Forbidden (not authenticated)
        416: Range Not Satisfiable
        404: File not found or access denied
    """
    # SECURITY: Require authentication for all media file access
    # Supports session auth or Authorization header token
    user, error = authenticate_media_request(request)
    if not user:
        logger.warning(f"Unauthenticated media access attempt: {path} - {error}")
        return HttpResponseForbidden(error or "Authentication required")

    # Security: Normalize path and prevent directory traversal attacks
    # Remove any path components that try to navigate up the directory tree
    path = Path(path).as_posix()
    if '..' in path or path.startswith('/') or '\\' in path:
        logger.warning(f"Blocked directory traversal attempt: {path}")
        raise Http404("Invalid path")
    
    # Build full file path
    full_path = Path(document_root) / path
    
    # Security: Verify the resolved path is still within document_root
    # This prevents symlink attacks and ensures files are in allowed directory
    try:
        full_path = full_path.resolve()
        document_root = Path(document_root).resolve()
        full_path.relative_to(document_root)
    except (ValueError, OSError) as e:
        logger.warning(f"Access denied for path: {path} - {e}")
        raise Http404("Access denied")
    
    # Check if file exists and is a file (not directory)
    if not full_path.exists() or not full_path.is_file():
        logger.debug(f"Media file not found: {path}")
        raise Http404(f"Media file not found: {path}")
    
    # Get file size
    file_size = full_path.stat().st_size

    # Limit concurrent media streaming requests per user/IP to reduce abuse.
    stream_counter_key, stream_limit_error = _acquire_media_stream_slot(request, user)
    if stream_limit_error:
        logger.warning("Blocked media request for %s: %s", path, stream_limit_error)
        response = HttpResponse(stream_limit_error, status=429)
        response['Retry-After'] = '5'
        return response
    
    # Get Range header
    range_header = request.META.get('HTTP_RANGE', '').strip()
    range_match = re.match(r'bytes=(\d+)-(\d*)', range_header)
    
    # Determine content type
    content_type = 'application/octet-stream'
    ext = full_path.suffix.lower()
    content_types = {
        '.mp3': 'audio/mpeg',
        '.mp4': 'video/mp4',
        '.m4a': 'audio/mp4',
        '.webm': 'video/webm',
        '.ogg': 'audio/ogg',
        '.wav': 'audio/wav',
        '.flac': 'audio/flac',
        '.aac': 'audio/aac',
        '.opus': 'audio/opus',
    }
    content_type = content_types.get(ext, content_type)
    
    # Open file
    try:
        file_obj = open(full_path, 'rb')
    except OSError:
        _release_media_stream_slot(stream_counter_key)
        raise Http404(f"Media file not found: {path}")
    
    # Handle Range request (for seeking)
    if range_match:
        start = int(range_match.group(1))
        end = range_match.group(2)
        end = int(end) if end else file_size - 1
        
        # Validate range
        if start >= file_size or end >= file_size or start > end:
            file_obj.close()
            _release_media_stream_slot(stream_counter_key)
            response = HttpResponse(status=416)  # Range Not Satisfiable
            response['Content-Range'] = f'bytes */{file_size}'
            return response
        
        # Calculate content length for this range
        length = end - start + 1
        
        # Create streaming response with partial content
        response = StreamingHttpResponse(
            stream_file_iterator(
                file_obj,
                offset=start,
                length=length,
                on_close=lambda: _release_media_stream_slot(stream_counter_key),
            ),
            status=206,  # Partial Content
            content_type=content_type,
        )
        response['Content-Length'] = str(length)
        response['Content-Range'] = f'bytes {start}-{end}/{file_size}'
        response['Accept-Ranges'] = 'bytes'
        
    else:
        # Serve entire file
        response = StreamingHttpResponse(
            stream_file_iterator(
                file_obj,
                on_close=lambda: _release_media_stream_slot(stream_counter_key),
            ),
            content_type=content_type,
        )
        response['Content-Length'] = str(file_size)
        response['Accept-Ranges'] = 'bytes'
    
    # Add caching headers for better performance
    response['Cache-Control'] = 'public, max-age=3600'
    response['Last-Modified'] = http_date(full_path.stat().st_mtime)
    
    # Add Content-Disposition for download fallback
    response['Content-Disposition'] = f'inline; filename="{full_path.name}"'
    
    # iOS Safari specific headers for better audio streaming
    response['X-Content-Type-Options'] = 'nosniff'
    
    # Allow cross-origin requests for audio (needed for PWA/Service Worker)
    response['Access-Control-Allow-Origin'] = '*'
    response['Access-Control-Allow-Methods'] = 'GET, HEAD, OPTIONS'
    response['Access-Control-Allow-Headers'] = 'Range, Content-Type'
    response['Access-Control-Expose-Headers'] = 'Content-Length, Content-Range, Accept-Ranges'
    
    return response
