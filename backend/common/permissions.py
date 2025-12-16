"""
DRF Permissions for multi-tenant user isolation
"""
from rest_framework import permissions


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
        if user.is_admin or user.is_superuser:
            return True
        
        # Check storage quota
        if user.storage_used_gb >= user.storage_quota_gb:
            self.message = f"Storage quota exceeded ({user.storage_used_gb:.1f} / {user.storage_quota_gb} GB)"
            return False
        
        return True
