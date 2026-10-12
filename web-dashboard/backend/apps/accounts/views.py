from urllib.parse import urlencode

from django.contrib.auth import logout
from django.core.paginator import EmptyPage, Paginator
from django.db.models import Count, Q
from django.middleware.csrf import get_token
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_protect
from drf_spectacular.utils import OpenApiParameter, extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from config.errors import ServiceError

from .models import User
from .permissions import ApprovedAdmin
from .serializers import (
    CSRFSerializer,
    EmptySerializer,
    ErrorEnvelopeSerializer,
    LoginSerializer,
    RegistrationResponseSerializer,
    RegistrationSerializer,
    TransitionSerializer,
    UserCountQuerySerializer,
    UserCountsSerializer,
    UserEnvelopeSerializer,
    UserListQuerySerializer,
    UserSerializer,
)
from .services import register_account, sign_in, transition_account
from .throttles import AuthThrottle

CSRF_HEADER = OpenApiParameter("X-CSRFToken", str, OpenApiParameter.HEADER, required=True,
                              description="Obtain from /auth/csrf/ and refresh after login.")
ERRORS = {400: ErrorEnvelopeSerializer, 403: ErrorEnvelopeSerializer,
          429: ErrorEnvelopeSerializer, 503: ErrorEnvelopeSerializer}


@method_decorator(csrf_protect, name="dispatch")
class PublicAuthView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [AuthThrottle]


class CSRFView(PublicAuthView):
    throttle_classes = []

    @extend_schema(responses=CSRFSerializer)
    def get(self, request):
        return Response({"csrf_token": get_token(request)})


class RegisterView(PublicAuthView):
    @extend_schema(request=RegistrationSerializer, parameters=[CSRF_HEADER],
                   responses={201: RegistrationResponseSerializer, **ERRORS})
    def post(self, request):
        serializer = RegistrationSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = register_account(serializer.validated_data)
        return Response({"id": user.pk, "status": user.status,
                         "message": "Your access request has been submitted for administrator review."}, status=201)


class LoginView(PublicAuthView):
    @extend_schema(request=LoginSerializer, parameters=[CSRF_HEADER],
                   responses={200: UserEnvelopeSerializer, 401: ErrorEnvelopeSerializer, **ERRORS})
    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        user = sign_in(request, serializer.validated_data)
        return Response({"user": UserSerializer(user).data, "session_expires_at": request.session.get_expiry_date()})


class LogoutView(PublicAuthView):
    # allowed even for suspended users
    throttle_classes = []

    @extend_schema(request=EmptySerializer, parameters=[CSRF_HEADER], responses={204: None, **ERRORS})
    def post(self, request):
        serializer = EmptySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        logout(request)
        return Response(status=204)


class MeView(APIView):
    @extend_schema(responses={200: UserEnvelopeSerializer, **ERRORS})
    def get(self, request):
        return Response({"user": UserSerializer(request.user).data,
                         "session_expires_at": request.session.get_expiry_date()})


def filtered_users(params):
    users = User.objects.all()
    for field in ("status", "role"):
        if field in params:
            users = users.filter(**{field: params[field]})
    if params.get("search"):
        value = params["search"]
        users = users.filter(Q(email__icontains=value) | Q(first_name__icontains=value) |
                             Q(last_name__icontains=value) | Q(organization__icontains=value))
    return users


class UserListView(APIView):
    permission_classes = [ApprovedAdmin]

    @extend_schema(parameters=[UserListQuerySerializer], responses=inline_serializer(
        name="AccountPage", fields={
            "count": serializers.IntegerField(),
            "next": serializers.CharField(allow_null=True),
            "previous": serializers.CharField(allow_null=True),
            "results": UserSerializer(many=True),
        }))
    def get(self, request):
        query = UserListQuerySerializer(data=request.query_params.dict())
        query.is_valid(raise_exception=True)
        params = query.validated_data
        users = filtered_users(params)
        pages = Paginator(users.order_by("-created_at", "-id"), params["page_size"])
        try:
            page = pages.page(params["page"])
        except EmptyPage as exc:
            raise ServiceError("not_found", "Page not found.", 404) from exc

        def link(number):
            return request.path + "?" + urlencode({**params, "page": number})

        return Response({"count": pages.count, "next": link(page.next_page_number()) if page.has_next() else None,
                         "previous": link(page.previous_page_number()) if page.has_previous() else None,
                         "results": UserSerializer(page.object_list, many=True).data})


class UserCountsView(APIView):
    permission_classes = [ApprovedAdmin]

    @extend_schema(parameters=[UserCountQuerySerializer], responses={200: UserCountsSerializer, **ERRORS})
    def get(self, request):
        query = UserCountQuerySerializer(data=request.query_params.dict())
        query.is_valid(raise_exception=True)
        totals = dict(filtered_users(query.validated_data).order_by()
                      .values_list("status").annotate(total=Count("id")))
        return Response({"counts": {status: totals.get(status, 0)
                                    for status in ("pending", "approved", "suspended", "rejected")}})


class TransitionView(APIView):
    permission_classes = [ApprovedAdmin]

    @extend_schema(request=TransitionSerializer, parameters=[
        CSRF_HEADER, OpenApiParameter("action", str, OpenApiParameter.PATH,
                                     enum=["approve", "reject", "suspend", "reactivate"])],
        responses={200: UserSerializer, 404: ErrorEnvelopeSerializer, 409: ErrorEnvelopeSerializer, **ERRORS})
    def post(self, request, user_id, action):
        serializer = TransitionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        if action == "approve" and serializer.validated_data:
            raise ServiceError("invalid_request", "Approval accepts an empty object.")
        user = transition_account(request.user, user_id, action,
                                  serializer.validated_data.get("reason", ""), request.request_id)
        return Response(UserSerializer(user).data)
