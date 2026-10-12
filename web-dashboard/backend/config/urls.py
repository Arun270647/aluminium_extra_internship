from django.urls import include, path

from apps.accounts.views import (
    CSRFView,
    LoginView,
    LogoutView,
    MeView,
    RegisterView,
    TransitionView,
    UserCountsView,
    UserListView,
)

from .health import live, ready

urlpatterns = [
    path("api/v1/", include("apps.research.urls")),
    path("api/v1/auth/csrf/", CSRFView.as_view()),
    path("api/v1/auth/register/", RegisterView.as_view()),
    path("api/v1/auth/login/", LoginView.as_view()),
    path("api/v1/auth/logout/", LogoutView.as_view()),
    path("api/v1/auth/me/", MeView.as_view()),
    path("api/v1/admin/users/", UserListView.as_view()),
    path("api/v1/admin/users/counts/", UserCountsView.as_view()),
    path("api/v1/admin/users/<uuid:user_id>/<str:action>/", TransitionView.as_view()),
    path("api/v1/health/live/", live),
    path("api/v1/health/ready/", ready),
]
handler404 = "config.errors.not_found"
handler500 = "config.errors.server_error"
