from django.urls import path

from . import views

urlpatterns = [
    path("models/", views.ModulesView.as_view()),
    path("predictions/", views.HistoryView.as_view()),
    path("predictions/export/", views.HistoryExportView.as_view()),
    path("predictions/<uuid:record_id>/", views.PredictionDetailView.as_view()),
    path("predictions/<str:kind>/", views.PredictionCreateView.as_view()),
    path("scenarios/", views.ScenariosView.as_view()),
    path("scenarios/compare/", views.CompareView.as_view()),
    path("scenarios/compare/export/", views.CompareExportView.as_view()),
    path("scenarios/<uuid:record_id>/", views.ScenarioDetailView.as_view()),
]
