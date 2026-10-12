import secrets

from django.conf import settings
from django.contrib.sessions.models import Session
from django.db import DatabaseError, connection
from django.http import JsonResponse
from django.views.decorators.http import require_GET

from .errors import envelope


@require_GET
def live(request):
    return JsonResponse({"status": "live"})


@require_GET
def ready(request):
    token = request.headers.get("X-Readiness-Token", "")
    if not settings.READINESS_TOKEN or not secrets.compare_digest(token, settings.READINESS_TOKEN):
        return JsonResponse(envelope(request, "permission_denied", "Operator access is required."), status=403)
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        Session.objects.exists()
    except DatabaseError:
        return JsonResponse({"status": "unready"}, status=503)
    return JsonResponse({"status": "degraded", "database": "ready", "sessions": "ready"})
