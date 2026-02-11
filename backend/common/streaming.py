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
from django.http import StreamingHttpResponse, HttpResponse, Http404, HttpResponseForbidden
from django.utils.http import http_date
from pathlib import Path
from wsgiref.util import FileWrapper
from rest_framework.authtoken.models import Token
from common.expiring_token import is_token_expired

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
    # Supports session auth, Authorization header, or query param token
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
    file_obj = open(full_path, 'rb')
    
    # Handle Range request (for seeking)
    if range_match:
        start = int(range_match.group(1))
        end = range_match.group(2)
        end = int(end) if end else file_size - 1
        
        # Validate range
        if start >= file_size or end >= file_size or start > end:
            file_obj.close()
            response = HttpResponse(status=416)  # Range Not Satisfiable
            response['Content-Range'] = f'bytes */{file_size}'
            return response
        
        # Calculate content length for this range
        length = end - start + 1
        
        # Create streaming response with partial content
        response = StreamingHttpResponse(
            range_file_iterator(file_obj, offset=start, length=length),
            status=206,  # Partial Content
            content_type=content_type,
        )
        response['Content-Length'] = str(length)
        response['Content-Range'] = f'bytes {start}-{end}/{file_size}'
        response['Accept-Ranges'] = 'bytes'
        
    else:
        # Serve entire file
        response = StreamingHttpResponse(
            FileWrapper(file_obj),
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
