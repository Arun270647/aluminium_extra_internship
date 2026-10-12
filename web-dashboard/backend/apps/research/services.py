import csv
import io
import json
import math
import uuid

from django.db import transaction
from django.http import HttpResponse
from django.shortcuts import get_object_or_404
from django.utils import timezone

from apps.accounts.models import User
from apps.audit.models import AuditEvent
from config.errors import ServiceError

from .ml.manifests import reviewed_metadata
from .ml.registry import MANIFESTS, SCHEMA_VERSION, load_artifact_for_version, verify_manifest
from .models import ModelVersion, Scenario
from .serializers import ScenarioDetailSerializer


def approved_actor(user):
    current = User.objects.select_for_update().get(pk=user.pk)
    if current.status != "approved" or not current.is_active:
        raise ServiceError("authentication_required", "Please sign in again.", 403)
    return current


def _operator_actor(user):
    actor = approved_actor(user)
    if actor.role != "admin":
        raise ServiceError("permission_denied", "Administrator access is required.", 403)
    return actor


def _operator_request_id(request_id):
    if request_id:
        return request_id
    return f"operator-{uuid.uuid4()}"


def verify_model_version(actor, kind: str, request_id: str = ""):
    manifest = MANIFESTS.get(kind)
    if manifest is None:
        raise ServiceError("not_found", "Analysis not found.", 404)
    evidence = verify_manifest(kind, force_reload=True)
    reviewed = reviewed_metadata(kind)
    with transaction.atomic():
        _operator_actor(actor)
        version, created = ModelVersion.objects.select_for_update().get_or_create(
            kind=kind,
            sha256=evidence["sha256"],
            adapter_version=evidence["adapter_version"],
            schema_version=evidence["schema_version"],
            defaults={
                "artifact_name": evidence["artifact_name"],
                "metadata": {"runtime": evidence["runtime"], **reviewed},
                "status": "unverified",
                "verified_at": timezone.now(),
            },
        )
        if not created and version.verified_at is None:
            version.verified_at = timezone.now()
            version.save(update_fields=["verified_at"])
    return version


def enable_model_version(actor, kind: str, model_version_id: str, request_id: str = ""):
    manifest = MANIFESTS.get(kind)
    if manifest is None:
        raise ServiceError("not_found", "Analysis not found.", 404)
    req_id = _operator_request_id(request_id)
    verification = verify_manifest(kind, force_reload=True)
    with transaction.atomic():
        actor = _operator_actor(actor)
        selected = get_object_or_404(ModelVersion.objects.select_for_update(), pk=model_version_id, kind=kind)
        if selected.verified_at is None:
            raise ServiceError("invalid_transition", "Model version must be verified before enablement.", 409)
        if selected.schema_version != SCHEMA_VERSION:
            raise ServiceError("invalid_transition", "Model schema version is incompatible with the API contract.", 409)
        if selected.sha256 != manifest["sha256"] or selected.adapter_version != manifest["adapter_version"]:
            raise ServiceError("invalid_transition", "Model version is not in the trusted artifact allowlist.", 409)
        if selected.sha256 != verification["sha256"] or selected.adapter_version != verification["adapter_version"]:
            raise ServiceError("invalid_transition", "Model verification is stale; re-verify before enablement.", 409)
        load_artifact_for_version(selected, force_reload=True)

        currently_enabled = (ModelVersion.objects.select_for_update()
                             .filter(kind=kind, status="enabled")
                             .exclude(pk=selected.pk)
                             .first())
        if currently_enabled:
            previous = currently_enabled.status
            currently_enabled.status = "disabled"
            currently_enabled.save(update_fields=["status"])
            AuditEvent.objects.create(
                actor=actor, action="model_disabled", target_type="model_version", target_id=currently_enabled.pk,
                request_id=req_id, metadata={"kind": kind, "previous_status": previous, "new_status": "disabled"},
            )

        if selected.status != "enabled":
            previous = selected.status
            selected.status = "enabled"
            selected.save(update_fields=["status"])
            AuditEvent.objects.create(
                actor=actor, action="model_enabled", target_type="model_version", target_id=selected.pk,
                request_id=req_id, metadata={"kind": kind, "previous_status": previous, "new_status": "enabled"},
            )
        return selected


def disable_model_version(actor, kind: str, request_id: str = ""):
    if kind not in MANIFESTS:
        raise ServiceError("not_found", "Analysis not found.", 404)
    req_id = _operator_request_id(request_id)
    with transaction.atomic():
        actor = _operator_actor(actor)
        selected = ModelVersion.objects.select_for_update().filter(kind=kind, status="enabled").first()
        if selected:
            previous = selected.status
            selected.status = "disabled"
            selected.save(update_fields=["status"])
            AuditEvent.objects.create(
                actor=actor, action="model_disabled", target_type="model_version", target_id=selected.pk,
                request_id=req_id, metadata={"kind": kind, "previous_status": previous, "new_status": "disabled"},
            )
        return selected


@transaction.atomic
def save_scenario(user, data, request_id, scenario_id=None, remove=False):
    actor = approved_actor(user)
    if scenario_id:
        scenario = get_object_or_404(Scenario.objects.select_for_update().select_related("prediction"),
                                     pk=scenario_id, user=actor)
        if remove:
            target_id = scenario.pk
            scenario.delete()
            action = "scenario_deleted"
        else:
            for field, value in data.items():
                setattr(scenario, field, value)
            scenario.save()
            target_id = scenario.pk
            action = "scenario_updated"
    else:
        from .models import Prediction
        prediction = get_object_or_404(Prediction, pk=data["prediction_id"], user=actor)
        scenario = Scenario.objects.create(user=actor, prediction=prediction, name=data["name"],
                                           description=data.get("description", ""))
        target_id = scenario.pk
        action = "scenario_created"
    AuditEvent.objects.create(actor=actor, action=action, target_type="scenario",
                              target_id=target_id, request_id=request_id, metadata={})
    return scenario


LABELS = {
    "al2o3_pct": ("Alumina · Al₂O₃", "wt %"), "sio2_pct": ("Silica · SiO₂", "wt %"),
    "fe2o3_pct": ("Iron oxide · Fe₂O₃", "wt %"), "tio2_pct": ("Titania · TiO₂", "wt %"),
    "cao_pct": ("Calcium oxide · CaO", "wt %"), "mgo_pct": ("Magnesia · MgO", "wt %"),
    "k2o_pct": ("Potassium oxide · K₂O", "wt %"), "na2o_pct": ("Sodium oxide · Na₂O", "wt %"),
    "feed_type": ("Feed condition", ""), "experiment_mode": ("Experiment", ""),
    "roasting_temperature_c": ("Roasting temperature", "°C"), "roasting_time_min": ("Roasting time", "min"),
    "lime_pct": ("Lime addition", "%"), "na2ok_g_l": ("Caustic concentration", "g/L"),
    "digestion_temperature_c": ("Digestion temperature", "°C"), "digestion_time_min": ("Digestion time", "min"),
    "as_ratio": ("Alumina / silica ratio", ""), "threshold_grade": ("Grade by A/S thresholds", ""),
    "classifier_grade": ("Classifier grade", ""), "classifier_probability": ("Classifier probability", "0–1"),
    "cluster_id": ("Cluster identifier", ""), "grade_disagreement": ("Grade disagreement", ""),
    "digestion_efficiency_pct": ("Digestion efficiency estimate", "%"),
}


def flatten(data, prefix=""):
    result = {}
    for key, value in data.items():
        if key in {"validation", "limitations", "unit"}:
            continue
        path = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            result.update(flatten(value, path))
        elif isinstance(value, (str, int, float, bool)) or value is None:
            result[path] = value
    return result


def label(path):
    if path.startswith("bauxite_concentrations_ug_g."):
        return (f"{path.split('.')[-1]} · Bauxite concentration", "µg/g")
    if path.startswith("elements.") and path.endswith(".extraction_efficiency_pct"):
        return (f"{path.split('.')[1]} · Extraction efficiency estimate", "%")
    key = path.split(".")[-1]
    return LABELS.get(key, (key.replace("_", " ").capitalize(), ""))


def comparison(user, ids):
    found = {s.pk: s for s in Scenario.objects.filter(user=user, pk__in=ids).select_related("prediction", "prediction__model_version")}
    if len(found) != len(ids):
        raise ServiceError("not_found", "One or more scenarios could not be found.", 404)
    items = [found[id_] for id_ in ids]
    predictions = [s.prediction for s in items]
    first = predictions[0]
    signatures = []
    for p in predictions:
        if p.schema_version != "1" or p.kind != first.kind or p.schema_version != first.schema_version:
            raise ServiceError("incompatible_scenarios", "Choose scenarios with the same analysis and result format.", 409)
        if p.kind == "alumina":
            signatures.append(p.output_data.get("unit"))
        elif p.kind == "secondary_metals":
            signatures.append(tuple(p.output_data.get("elements", {}).get(e, {}).get("unit") for e in ["Li", "Ga", "Sc"]))
        else:
            signatures.append("ratio")
    expected = "percent" if first.kind == "alumina" else (
        ("percent", "percent", "percent") if first.kind == "secondary_metals" else "ratio")
    if any(s != expected for s in signatures):
        raise ServiceError("incompatible_scenarios", "These result units cannot be compared.", 409)

    def rows(attr):
        columns = [flatten(getattr(p, attr)) for p in predictions]
        keys = dict.fromkeys(key for col in columns for key in col)
        return [{"key": key, "label": label(key)[0], "unit": label(key)[1],
                 "values": [col.get(key) for col in columns]} for key in keys]

    warnings = ["Laboratory proof of concept. Compare matching experiments; differences do not establish causation."]
    if len({p.model_version_id for p in predictions}) > 1:
        warnings.append("Different model versions produced these results.")
    for prediction in predictions:
        for limitation in prediction.output_data.get("limitations", []):
            if isinstance(limitation, str) and limitation not in warnings:
                warnings.append(limitation)
    return {"scenarios": ScenarioDetailSerializer(items, many=True).data,
            "parameter_rows": rows("input_data"), "result_rows": rows("output_data"), "warnings": warnings}


def safe_cell(value):
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False, allow_nan=False)
    if isinstance(value, float) and not math.isfinite(value):
        raise ServiceError("invalid_request", "This record cannot be exported.")
    if isinstance(value, str) and (value.lstrip().startswith(("=", "+", "-", "@")) or
                                    any(ch in value[:1] for ch in "\t\r\n")):
        return "'" + value
    return value


def csv_response(filename, rows):
    out = io.StringIO(newline="")
    writer = csv.writer(out)
    for row in rows:
        writer.writerow([safe_cell(cell) for cell in row])
    response = HttpResponse("\ufeff" + out.getvalue(), content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    return response
