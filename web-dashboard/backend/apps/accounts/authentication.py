from rest_framework.authentication import SessionAuthentication as DRFSessionAuthentication

from config.errors import ServiceError


class SessionAuthentication(DRFSessionAuthentication):
    def enforce_csrf(self, request):
        try:
            super().enforce_csrf(request)
        except Exception as exc:
            from rest_framework.exceptions import PermissionDenied

            if not isinstance(exc, PermissionDenied):
                raise
            raise ServiceError("csrf_failed", "Refresh the page and try again.", 403) from exc
