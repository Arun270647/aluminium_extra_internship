import uuid

from django.http import JsonResponse
from django.utils.cache import patch_cache_control


class RequestPolicyMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        request.request_id = str(uuid.uuid4())
        try:
            length = int(request.META.get("CONTENT_LENGTH") or 0)
        except ValueError:
            length = 32769
        if length > 32768:
            response = JsonResponse(
                {"error": {"code": "invalid_request", "message": "Request is too large.",
                           "fields": {}, "request_id": request.request_id}}, status=400
            )
        else:
            response = self.get_response(request)
        response["X-Request-ID"] = request.request_id
        response["X-Frame-Options"] = "DENY"
        if request.path.startswith("/api/"):
            patch_cache_control(response, private=True, no_store=True)
        return response
