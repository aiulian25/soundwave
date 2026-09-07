"""Storage accounting middleware.

Multi-tenant isolation is deliberately NOT done here. It is enforced per view by
ApiBaseView.filter_owned (common/views.py), which scopes strictly by owner --
including admins. A request-level helper previously lived here and let admins bypass
that scoping; it was unused and has been removed.
"""
from django.utils.deprecation import MiddlewareMixin


class StorageQuotaMiddleware(MiddlewareMixin):
    """Middleware to track storage usage"""
    
    def process_response(self, request, response):
        """Update storage usage after file operations"""
        # This can be expanded to track file uploads/deletions
        # For now, it's a placeholder for future implementation
        return response
