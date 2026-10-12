from config.errors import ServiceError

from ..models import ModelVersion
from ..serializers import model_label
from .registry import MANIFESTS, SCHEMA_VERSION, enabled_version, load_artifact_for_version

INPUT_SCHEMAS = {
    "ore": {
        "fields": [
            {"key": "al2o3_pct", "label": "Al₂O₃", "unit": "wt %", "min": 0, "max": 100, "required": True},
            {"key": "sio2_pct", "label": "SiO₂", "unit": "wt %", "min": 0.001, "max": 100, "required": True},
            {"key": "fe2o3_pct", "label": "Fe₂O₃", "unit": "wt %", "min": 0, "max": 100, "required": True},
            {"key": "tio2_pct", "label": "TiO₂", "unit": "wt %", "min": 0, "max": 100, "required": True},
            {"key": "cao_pct", "label": "CaO", "unit": "wt %", "min": 0, "max": 100, "required": True},
            {"key": "mgo_pct", "label": "MgO", "unit": "wt %", "min": 0, "max": 100, "required": True},
            {"key": "k2o_pct", "label": "K₂O", "unit": "wt %", "min": 0, "max": 100, "required": True},
            {"key": "na2o_pct", "label": "Na₂O", "unit": "wt %", "min": 0, "max": 100, "required": True},
        ],
        "modes": None,
    },
    "alumina": {
        "fields": [
            {"key": "feed_type", "label": "Feed type", "type": "enum", "options": ["roasted", "unroasted"],
             "required": True},
            {"key": "al2o3_pct", "label": "Al₂O₃", "unit": "wt %", "min": 0, "max": 100, "required": True},
            {"key": "sio2_pct", "label": "SiO₂", "unit": "wt %", "min": 0.001, "max": 100, "required": True},
        ],
        "modes": [
            {"value": "roasting", "label": "Roasting", "fields": [
                {"key": "roasting_temperature_c", "label": "Roasting temperature", "unit": "°C", "min": 0,
                 "required": True},
                {"key": "roasting_time_min", "label": "Roasting time", "unit": "min", "min": 0, "required": True},
            ]},
            {"value": "lime", "label": "Lime addition", "fields": [
                {"key": "lime_pct", "label": "Lime", "unit": "percent", "min": 0, "max": 100, "required": True},
            ]},
            {"value": "caustic", "label": "Caustic concentration", "fields": [
                {"key": "na2ok_g_l", "label": "Na₂O (caustic)", "unit": "g/L", "min": 0, "required": True},
            ]},
            {"value": "digestion_temperature", "label": "Digestion temperature", "fields": [
                {"key": "digestion_temperature_c", "label": "Temperature", "unit": "°C", "min": 0,
                 "required": True},
            ]},
            {"value": "digestion_time", "label": "Digestion time", "fields": [
                {"key": "digestion_time_min", "label": "Time", "unit": "min", "min": 0, "required": True},
            ]},
        ],
    },
    "secondary_metals": {
        "fields": [
            {"key": "Li", "label": "Lithium (Li)", "unit": "µg/g", "min": 0, "required": True,
             "group": "bauxite_concentrations_ug_g"},
            {"key": "Ga", "label": "Gallium (Ga)", "unit": "µg/g", "min": 0, "required": True,
             "group": "bauxite_concentrations_ug_g"},
            {"key": "Sc", "label": "Scandium (Sc)", "unit": "µg/g", "min": 0, "required": True,
             "group": "bauxite_concentrations_ug_g"},
        ],
        "modes": [
            {"value": "roasting", "label": "Roasting", "fields": []},
            {"value": "lime", "label": "Lime addition", "fields": [
                {"key": "lime_pct", "label": "Lime", "unit": "percent", "min": 0, "max": 100, "required": True},
            ]},
            {"value": "temperature", "label": "Digestion temperature", "fields": [
                {"key": "digestion_temperature_c", "label": "Temperature", "unit": "°C", "min": 0,
                 "required": True},
            ]},
        ],
    },
}

TARGETS = {
    "ore": ["as_ratio", "threshold_grade", "classifier_grade", "classifier_probability", "cluster_id",
            "grade_disagreement"],
    "alumina": ["digestion_efficiency_pct"],
    "secondary_metals": ["Li.extraction_efficiency_pct", "Ga.extraction_efficiency_pct",
                         "Sc.extraction_efficiency_pct"],
}

VALIDATION_EVIDENCE = {
    "ore": {
        "method": "RandomForest classification plus A/S threshold and clustering diagnostics.",
        "samples": 1091,
        "unit": None,
        "note": "Classifier probabilities are uncalibrated model scores.",
    },
    "alumina": {
        "method": "Ridge regression (alpha=1.0).",
        "samples": 55,
        "unit": "percent",
        "metrics": {"structure_aware_r2": -0.162, "sample_group_r2": -1.614, "random_split_r2": 0.436},
        "note": "Structure-aware validation is the governing metric.",
    },
    "secondary_metals": {
        "method": "Three independent Ridge regressions (alpha=5.0, LOOCV).",
        "unit": "percent",
        "elements": {
            "Li": {"samples": 25, "loocv_mae_pct_points": 8.75, "loocv_r2": 0.175},
            "Ga": {"samples": 30, "loocv_mae_pct_points": 5.77, "loocv_r2": -0.035},
            "Sc": {"samples": 30, "loocv_mae_pct_points": 6.76, "loocv_r2": 0.094},
        },
        "note": "Screening-only estimates; not for economic recommendation.",
    },
}

LIMITATIONS_TEXT = {
    "ore": [
        "Demonstration ore classification. Grade labels are geochemical descriptors, not economic valuations.",
        "Source geochemistry includes unresolved data-quality anomalies; use outputs as screening only.",
        "Cluster 3 based on only 1 training sample.",
    ],
    "alumina": [
        "Laboratory proof-of-concept (n=55). Limited generalization to new conditions.",
        "Structure-aware R²=−0.162. Random-split R²=0.436 is optimistic.",
    ],
    "secondary_metals": [
        "Experimental models (n=25-30 per element). Weak predictive performance.",
        "Ga R²=−0.035: worse than predicting the mean.",
        "Estimates are qualitative screening only.",
    ],
}


def reviewed_metadata(kind: str) -> dict:
    return {
        "targets": TARGETS.get(kind, []),
        "validation": VALIDATION_EVIDENCE.get(kind),
        "limitations": LIMITATIONS_TEXT.get(kind, []),
    }


def module_info(kind: str) -> dict:
    manifest = MANIFESTS.get(kind, {})
    version = enabled_version(kind)
    if version is None:
        version = ModelVersion.objects.filter(kind=kind).order_by("-created_at", "-id").first()
    available = False
    if version and version.status == "enabled":
        try:
            # check the version we already looked up, not a fresh query
            load_artifact_for_version(version)
            available = True
        except ServiceError:
            pass
    runtime_not_ready = bool(version and version.status == "enabled" and not available)

    unavailable_limitations = ["Model validation is pending. Estimates are not available yet."]
    if runtime_not_ready:
        unavailable_limitations = ["Model is enabled but this worker is not ready to serve it yet."]

    return {
        "kind": kind,
        "available": available,
        "model_version_id": version.id if available and version else None,
        "model_label": model_label(version) if available and version else None,
        "schema_version": version.schema_version if version else SCHEMA_VERSION,
        "input_schema": INPUT_SCHEMAS.get(kind) if available else None,
        "targets": TARGETS.get(kind, []) if available else [],
        "validation": {
            "adapter_version": manifest.get("adapter_version"),
            "digest_verified": True,
            "runtime": manifest.get("runtime"),
            "evidence": VALIDATION_EVIDENCE.get(kind),
        } if available else None,
        "status": version.status if version else "unverified",
        "limitations": LIMITATIONS_TEXT.get(kind, []) if available else unavailable_limitations,
    }
