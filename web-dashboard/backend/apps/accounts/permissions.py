from rest_framework.permissions import BasePermission

from config.errors import ServiceError


class ApprovedAccount(BasePermission):
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            raise ServiceError("authentication_required", "Please sign in to continue.", 403)
        if request.user.status != "approved" or not request.user.is_active:
            raise ServiceError(f"account_{request.user.status}", "This account does not have access.", 403)
        return True


class ApprovedAdmin(ApprovedAccount):
    def has_permission(self, request, view):
        super().has_permission(request, view)
        if request.user.role != "admin":
            raise ServiceError("permission_denied", "Administrator access is required.", 403)
        return True


class ApprovedAnalyst(ApprovedAccount):
    def has_permission(self, request, view):
        super().has_permission(request, view)
        if request.user.role != "user":
            raise ServiceError("permission_denied", "Analyst access is required.", 403)
        return True
