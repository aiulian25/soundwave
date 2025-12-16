"""Middleware for user isolation and multi-tenancy"""
from django.utils.deprecation import MiddlewareMixin
from django.db.models import Q


class UserIsolationMiddleware(MiddlewareMixin):
    """
    Middleware to ensure users can only access their own data
    Admins can access all data
    """
    
    def process_request(self, request):
        """Add user isolation context to request"""
        if hasattr(request, 'user') and request.user.is_authenticated:
            # Add helper method to filter queryset by user
            def filter_by_user(queryset):
                """Filter queryset to show only user's data or all if admin"""
                if request.user.is_admin or request.user.is_superuser:
                    # Admins can see all data
                    return queryset
                # Regular users see only their own data
                if hasattr(queryset.model, 'owner'):
                    return queryset.filter(owner=request.user)
                elif hasattr(queryset.model, 'user'):
                    return queryset.filter(user=request.user)
                return queryset
            
            request.filter_by_user = filter_by_user
            request.is_admin_user = request.user.is_admin or request.user.is_superuser
        
        return None


class StorageQuotaMiddleware(MiddlewareMixin):
    """Middleware to track storage usage"""
    
    def process_response(self, request, response):
        """Update storage usage after file operations"""
        # This can be expanded to track file uploads/deletions
        # For now, it's a placeholder for future implementation
        return response
