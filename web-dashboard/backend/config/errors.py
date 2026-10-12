import logging

from django.db import DatabaseError
from django.http import JsonResponse
from rest_framework.exceptions import APIException, Throttled, ValidationError
from rest_framework.response import Response

logger = logging.getLogger(__name__)


class ServiceError(APIException):
    def __init__(self, code, message, status=400, *, fields=None):
        self.status_code = status
        self.fields = fields or {}
        super().__init__(message, code=code)


def envelope(request, code, message, fields=None):
    return {"error": {"code": code, "message": message, "fields": fields or {},
                      "request_id": getattr(request, "request_id", "")}}


def csrf_failure(request, reason=""):
    return JsonResponse(envelope(request, "csrf_failed", "Refresh the page and try again."), status=403)


def exception_handler(exc, context):
    from rest_framework.views import exception_handler as drf_exception_handler

    request = context["request"]
    response = drf_exception_handler(exc, context)
    if isinstance(exc, ValidationError):
        fields = exc.detail if isinstance(exc.detail, dict) else {"non_field_errors": exc.detail}
        response.data = envelope(request, "validation_error", "Check the highlighted fields.", fields)
    elif response is not None:
        code = getattr(exc, "default_code", "invalid_request")
        detail = getattr(exc, "detail", None)
        if isinstance(exc, ServiceError):
            code = detail.code
        elif isinstance(exc, Throttled):
            code = "rate_limited"
        elif response.status_code == 404:
            code = "not_found"
        response.data = envelope(request, code, str(detail or "The request could not be completed."),
                                 getattr(exc, "fields", None))
    else:
        code = "service_unavailable" if isinstance(exc, DatabaseError) else "internal_error"
        logger.error("request_failed id=%s type=%s", request.request_id, type(exc).__name__)
        response = Response(envelope(request, code, "The service is unavailable. Please try again."),
                            status=503 if isinstance(exc, DatabaseError) else 500)
    return response


def not_found(request, exception=None):
    return JsonResponse(envelope(request, "not_found", "This endpoint was not found."), status=404)


def server_error(request):
    return JsonResponse(envelope(request, "internal_error", "The request could not be completed."), status=500)
