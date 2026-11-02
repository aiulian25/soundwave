"""
DRF Permissions for multi-tenant user isolation
"""
from urllib.parse import urlsplit

from django.conf import settings
from rest_framework import permissions

CROSS_SITE_REQUEST_MESSAGE = 'This request came from another website.'


class NotFromAnotherSite(permissions.BasePermission):
    """Refuses browser requests another website started; clients without an Origin pass.

    For views with no session to carry a CSRF check, such as login: SameSite does not stop a
    cross-site form from setting the session cookie its response returns.
    """

    message = CROSS_SITE_REQUEST_MESSAGE

    def has_permission(self, request, view):
        origin = request.META.get('HTTP_ORIGIN')
        if not origin:
            return True
        # Hosts, not schemes: behind a TLS proxy this app can see http while the browser says https.
        same_host = urlsplit(origin).netloc == request.get_host()
        return same_host or origin.rstrip('/') in settings.PASSKEY_ALLOWED_ORIGINS


class IsOwnerOrAdmin(permissions.BasePermission):
    """
    Object-level permission to only allow owners or admins to access objects
    """
    
    def has_permission(self, request, view):
        """Check if user is authenticated"""
        return request.user and request.user.is_authenticated
    
    def has_object_permission(self, request, view, obj):
        """Check if user is owner or admin"""
        # Admins can access everything
        if request.user.is_admin or request.user.is_superuser:
            return True
        
        # Check if object has owner field
        if hasattr(obj, 'owner'):
            return obj.owner == request.user
        
        # Check if object has user field
        if hasattr(obj, 'user'):
            return obj.user == request.user
        
        # Check if object is the user itself
        if obj == request.user:
            return True
        
        return False


class IsAdminOrReadOnly(permissions.BasePermission):
    """
    Admins can edit, regular users can only read their own data
    """
    
    def has_permission(self, request, view):
        """Check if user is authenticated"""
        if not request.user or not request.user.is_authenticated:
            return False
        
        # Read permissions are allowed for authenticated users
        if request.method in permissions.SAFE_METHODS:
            return True
        
        # Write permissions only for admins
        return request.user.is_admin or request.user.is_superuser
    
    def has_object_permission(self, request, view, obj):
        """Check object-level permissions"""
        # Read permissions for owner or admin
        if request.method in permissions.SAFE_METHODS:
            if request.user.is_admin or request.user.is_superuser:
                return True
            if hasattr(obj, 'owner'):
                return obj.owner == request.user
            if hasattr(obj, 'user'):
                return obj.user == request.user
        
        # Write permissions only for admins
        return request.user.is_admin or request.user.is_superuser


class CanManageUsers(permissions.BasePermission):
    """
    Only admins can manage users
    """
    
    def has_permission(self, request, view):
        """Check if user is admin"""
        return (
            request.user and
            request.user.is_authenticated and
            (request.user.is_admin or request.user.is_superuser)
        )


class WithinQuotaLimits(permissions.BasePermission):
    """
    Check if user is within their quota limits
    """
    message = "You have exceeded your quota limits"
    
    def has_permission(self, request, view):
        """Check quota limits for POST requests"""
        if request.method != 'POST':
            return True
        
        user = request.user
        if not user or not user.is_authenticated:
            return False
        
        # Admins bypass quota checks
        if user.has_unlimited_storage:
            return True
        
        # Check storage quota
        if user.storage_used_bytes() >= user.storage_quota_bytes:
            self.message = f"Storage quota of {user.storage_quota_gb} GB is used up"
            return False
        
        return True
