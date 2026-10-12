import uuid
from urllib.parse import urlencode

from django.core.paginator import EmptyPage, Paginator
from django.db import IntegrityError, connection, transaction
from django.db.models import Exists, OuterRef, Q, Subquery
from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.models import User
from apps.accounts.permissions import ApprovedAdmin, ApprovedAnalyst
from apps.accounts.serializers import EmptySerializer, ErrorEnvelopeSerializer
from apps.accounts.throttles import AccountThrottle, PredictionThrottle
from apps.audit.models import AuditEvent
from config.errors import ServiceError

from .ml.adapters import normalize_input, validate_serving_input
from .ml.canonical import request_hash
from .ml.inference import run_prediction
from .ml.manifests import module_info
from .ml.registry import SCHEMA_VERSION, enabled_version
from .models import KINDS, ModelVersion, Prediction, Scenario
from .serializers import (
    AdminHistoryQuery,
    AuditPageSerializer,
    AuditQuery,
    CompareQuery,
    ComparisonSerializer,
    HistoryPageSerializer,
    HistoryQuery,
    ModuleSerializer,
    PredictionSerializer,
    RecordQuery,
    ScenarioDetailSerializer,
    ScenarioInput,
    ScenarioPageSerializer,
    ScenarioSerializer,
    ScenarioUpdate,
    SystemStatusSerializer,
    result_detail,
    result_summary,
)
from .services import approved_actor, comparison, csv_response, save_scenario

CSRF_HEADER = OpenApiParameter("X-CSRFToken", str, OpenApiParameter.HEADER, required=True)
KIND_MAP = {"ore": "ore", "alumina": "alumina", "secondary-metals": "secondary_metals"}


def _resolve_kind(kind: str) -> str:
    internal = KIND_MAP.get(kind)
    if internal is None:
        raise ServiceError("not_found", "Analysis not found.", 404)
    return internal


def parameters(request, serializer):
    parsed = serializer(data=request.query_params.dict())
    parsed.is_valid(raise_exception=True)
    return parsed.validated_data


def paginated(request, query, params, render):
    pages = Paginator(query, params.get("page_size", 20))
    try:
        page = pages.page(params.get("page", 1))
    except EmptyPage as exc:
        raise ServiceError("not_found", "Page not found.", 404) from exc

    def link(number):
        return request.path + "?" + urlencode({**request.query_params.dict(), "page": number})

    return Response({"count": pages.count, "next": link(page.next_page_number()) if page.has_next() else None,
                     "previous": link(page.previous_page_number()) if page.has_previous() else None,
                     "results": [render(item) for item in page.object_list]})


def modules():
    return [module_info(kind) for kind, _ in KINDS]


class ModulesView(APIView):
    permission_classes = [ApprovedAnalyst]

    @extend_schema(responses=ModuleSerializer(many=True))
    def get(self, request):
        return Response(modules())


class PredictionCreateView(APIView):
    permission_classes = [ApprovedAnalyst]
    throttle_classes = [AccountThrottle, PredictionThrottle]

    @extend_schema(request=OpenApiTypes.OBJECT, parameters=[
        CSRF_HEADER,
        OpenApiParameter("Idempotency-Key", OpenApiTypes.UUID, OpenApiParameter.HEADER, required=True),
    ], responses={201: PredictionSerializer, 200: PredictionSerializer,
                  400: ErrorEnvelopeSerializer, 403: ErrorEnvelopeSerializer,
                  409: ErrorEnvelopeSerializer, 422: ErrorEnvelopeSerializer, 429: ErrorEnvelopeSerializer,
                  503: ErrorEnvelopeSerializer})
    def post(self, request, kind):
        internal_kind = _resolve_kind(kind)
        idempotency_key = request.META.get("HTTP_IDEMPOTENCY_KEY")
        if not idempotency_key:
            raise ServiceError("validation_error", "Idempotency-Key header is required.", 400)
        try:
            key_uuid = uuid.UUID(idempotency_key)
        except ValueError as exc:
            raise ServiceError("validation_error", "Idempotency-Key must be a valid UUID.", 400) from exc

        normalized_input = normalize_input(internal_kind, request.data)
        digest = request_hash(internal_kind, SCHEMA_VERSION, normalized_input)

        existing = Prediction.objects.filter(user=request.user, request_key=key_uuid).first()
        if existing:
            if existing.kind != internal_kind or existing.request_hash != digest:
                raise ServiceError("idempotency_conflict", "Idempotency key already exists for a different request.", 409)
            return Response(PredictionSerializer(existing).data, status=200)

        validate_serving_input(internal_kind, normalized_input)
        version = enabled_version(internal_kind)
        if version is None:
            raise ServiceError("model_unavailable", "Requested model is not available.", 503)
        output = run_prediction(internal_kind, normalized_input, version)

        prediction = None
        replay = None
        try:
            with transaction.atomic():
                actor = approved_actor(request.user)
                replay = Prediction.objects.select_for_update().filter(user=actor, request_key=key_uuid).first()
                if replay:
                    if replay.kind != internal_kind or replay.request_hash != digest:
                        raise ServiceError("idempotency_conflict", "Idempotency key already exists for a different request.", 409)
                else:
                    bound = ModelVersion.objects.select_for_update().get(pk=version.pk)
                    if bound.status != "enabled":
                        raise ServiceError("model_version_changed", "Model version changed during the request.", 409)
                    prediction = Prediction.objects.create(
                        user=actor,
                        model_version=bound,
                        kind=internal_kind,
                        request_key=key_uuid,
                        request_hash=digest,
                        input_data=normalized_input,
                        output_data=output,
                        schema_version=SCHEMA_VERSION,
                    )
        except IntegrityError as exc:
            replay = Prediction.objects.filter(user=request.user, request_key=key_uuid).first()
            if replay and replay.kind == internal_kind and replay.request_hash == digest:
                return Response(PredictionSerializer(replay).data, status=200)
            raise ServiceError("idempotency_conflict", "Idempotency key already exists for a different request.", 409) from exc
        if replay:
            return Response(PredictionSerializer(replay).data, status=200)
        return Response(PredictionSerializer(prediction).data, status=201)


def prediction_summary(p, admin=False):
    result = {key: PredictionSerializer(p).data[key] for key in
              ["id", "kind", "created_at", "model_version_id", "model_label", "schema_version"]}
    result["summary"] = dict(KINDS)[p.kind] + " · saved prediction"
    result["result_summary"] = result_summary(p)
    result["result_detail"] = result_detail(p)
    result["scenario_name"] = getattr(p, "latest_scenario_name", None)
    if admin:
        result["user"] = {"id": p.user_id, "name": f"{p.user.first_name} {p.user.last_name}"}
    return result


def history_query(request, admin=False):
    params = parameters(request, AdminHistoryQuery if admin else HistoryQuery)
    query = Prediction.objects.select_related("user", "model_version")
    if not admin:
        query = query.filter(user=request.user)
    owned = Scenario.objects.filter(prediction=OuterRef("pk"), user=OuterRef("user"))
    query = query.annotate(latest_scenario_name=Subquery(owned.order_by("-updated_at", "-id").values("name")[:1]))
    for param, lookup in [("kind", "kind"), ("date_from", "created_at__gte"),
                          ("date_to", "created_at__lt"), ("user_id", "user_id")]:
        if param in params:
            query = query.filter(**{lookup: params[param]})
    term = (params.get("search") or "").strip()
    if term:
        kinds = [key for key, label in KINDS if term.lower() in label.lower() or term.lower() in key]
        query = query.filter(Exists(owned.filter(name__icontains=term)) | Q(kind__in=kinds)
                             | Q(output_data__threshold_grade__icontains=term)
                             | Q(output_data__classifier_grade__icontains=term)
                             | Q(input_data__feed_type__icontains=term)
                             | Q(input_data__experiment_mode__icontains=term))
    return query.order_by("-created_at", "-id"), params


class HistoryView(APIView):
    permission_classes = [ApprovedAnalyst]
    admin = False

    @extend_schema(operation_id="prediction_history_list", parameters=[HistoryQuery], responses=HistoryPageSerializer)
    def get(self, request):
        query, params = history_query(request, self.admin)
        return paginated(request, query, params, lambda p: prediction_summary(p, self.admin))


class AdminHistoryView(HistoryView):
    admin = True
    permission_classes = [ApprovedAdmin]

    @extend_schema(operation_id="admin_prediction_history_list", parameters=[AdminHistoryQuery], responses=HistoryPageSerializer)
    def get(self, request):
        return super().get(request)


class PredictionDetailView(APIView):
    permission_classes = [ApprovedAnalyst]
    admin = False

    @extend_schema(responses=PredictionSerializer)
    def get(self, request, record_id):
        query = Prediction.objects.all() if self.admin else Prediction.objects.filter(user=request.user)
        return Response(PredictionSerializer(get_object_or_404(query, pk=record_id)).data)


class AdminPredictionDetailView(PredictionDetailView):
    admin = True
    permission_classes = [ApprovedAdmin]


class HistoryExportView(APIView):
    permission_classes = [ApprovedAnalyst]
    @extend_schema(parameters=[HistoryQuery], responses={(200, "text/csv"): OpenApiTypes.STR})
    def get(self, request):
        query, _ = history_query(request)
        records = list(query[:1001])
        if len(records) > 1000:
            raise ServiceError("invalid_request", "Narrow your filters to export at most 1,000 predictions.")
        rows = [["id", "kind", "created_at", "model_version_id", "schema_version", "input_json", "output_json"]]
        rows += [[p.id, p.kind, p.created_at.isoformat(), p.model_version_id, p.schema_version,
                  p.input_data, p.output_data] for p in records]
        return csv_response("prediction-history.csv", rows)


class ScenariosView(APIView):
    permission_classes = [ApprovedAnalyst]
    @extend_schema(operation_id="scenario_list", parameters=[RecordQuery], responses=ScenarioPageSerializer)
    def get(self, request):
        params = parameters(request, RecordQuery)
        query = Scenario.objects.filter(user=request.user).select_related("prediction", "prediction__model_version").order_by("-updated_at", "-id")
        if "kind" in params:
            query = query.filter(prediction__kind=params["kind"])
        return paginated(request, query, params, lambda s: ScenarioSerializer(s).data)

    @extend_schema(request=ScenarioInput, parameters=[CSRF_HEADER], responses={201: ScenarioSerializer})
    def post(self, request):
        parsed = ScenarioInput(data=request.data)
        parsed.is_valid(raise_exception=True)
        scenario = save_scenario(request.user, parsed.validated_data, request.request_id)
        return Response(ScenarioSerializer(scenario).data, status=201)


class ScenarioDetailView(APIView):
    permission_classes = [ApprovedAnalyst]
    @extend_schema(responses=ScenarioDetailSerializer)
    def get(self, request, record_id):
        record = get_object_or_404(Scenario.objects.select_related("prediction", "prediction__model_version"), pk=record_id, user=request.user)
        return Response(ScenarioDetailSerializer(record).data)

    @extend_schema(request=ScenarioUpdate, parameters=[CSRF_HEADER], responses=ScenarioSerializer)
    def patch(self, request, record_id):
        parsed = ScenarioUpdate(data=request.data)
        parsed.is_valid(raise_exception=True)
        scenario = save_scenario(request.user, parsed.validated_data, request.request_id, record_id)
        return Response(ScenarioSerializer(scenario).data)

    @extend_schema(request=EmptySerializer, parameters=[CSRF_HEADER], responses={204: None})
    def delete(self, request, record_id):
        parsed = EmptySerializer(data=request.data or {})
        parsed.is_valid(raise_exception=True)
        save_scenario(request.user, {}, request.request_id, record_id, remove=True)
        return Response(status=204)


class CompareView(APIView):
    permission_classes = [ApprovedAnalyst]
    @extend_schema(parameters=[CompareQuery], responses=ComparisonSerializer)
    def get(self, request):
        params = parameters(request, CompareQuery)
        return Response(comparison(request.user, params["ids"]))


class CompareExportView(APIView):
    permission_classes = [ApprovedAnalyst]
    @extend_schema(parameters=[CompareQuery], responses={(200, "text/csv"): OpenApiTypes.STR})
    def get(self, request):
        data = comparison(request.user, parameters(request, CompareQuery)["ids"])
        rows = [["Parameter / result", "Unit"] + [s["name"] for s in data["scenarios"]]]
        rows += [["Model version", ""] + [s["model_version_id"] for s in data["scenarios"]]]
        rows += [[r["label"], r["unit"], *r["values"]] for r in data["parameter_rows"] + data["result_rows"]]
        rows += [["Warning", "", warning] for warning in data["warnings"]]
        return csv_response("scenario-comparison.csv", rows)


class AuditView(APIView):
    permission_classes = [ApprovedAdmin]

    @extend_schema(parameters=[AuditQuery], responses=AuditPageSerializer)
    def get(self, request):
        params = parameters(request, AuditQuery)
        query = AuditEvent.objects.select_related("actor").order_by("-created_at", "-id")
        if "action" in params:
            query = query.filter(action=params["action"])
        return paginated(request, query, params, lambda e: {
            "id": e.id, "action": e.action, "target_type": e.target_type, "target_id": e.target_id,
            "created_at": e.created_at,
            "actor": f"{e.actor.first_name} {e.actor.last_name}" if e.actor else "System",
            "metadata": {key: value for key, value in e.metadata.items() if key in ["previous_status", "new_status"]},
        })


class SystemStatusView(APIView):
    permission_classes = [ApprovedAdmin]

    @extend_schema(responses=SystemStatusSerializer)
    def get(self, request):
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        return Response({"database": "ready", "modules": modules(),
                         "counts": {"pending_accounts": User.objects.filter(status="pending").count(),
                                    "approved_accounts": User.objects.filter(status="approved").count(),
                                    "predictions": Prediction.objects.count(), "scenarios": Scenario.objects.count()}})
