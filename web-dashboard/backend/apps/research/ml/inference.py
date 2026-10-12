import numpy as np

from config.errors import ServiceError

from ..models import ModelVersion
from .adapters import adapt_alumina, adapt_ore, adapt_secondary_metals, validate_serving_input
from .manifests import LIMITATIONS_TEXT, VALIDATION_EVIDENCE
from .registry import load_artifact_for_version, mark_unready
from .validators import (
    validate_alumina_output,
    validate_ore_output,
    validate_secondary_metals_output,
)


def _runtime_error(version: ModelVersion, message: str):
    mark_unready(version, message)
    raise ServiceError("model_unavailable", message, 503)


def _bundle_for(kind: str, version: ModelVersion) -> dict:
    artifact = load_artifact_for_version(version)
    if not isinstance(artifact, dict):
        _runtime_error(version, "Model artifact bundle is invalid.")
    return artifact


def predict_ore(data: dict, version: ModelVersion) -> dict:
    bundle = _bundle_for("ore", version)
    classifier_bundle = bundle.get("ore_grade_classifier", {})
    clustering = bundle.get("clustering", {})

    model = classifier_bundle.get("model")
    scaler = clustering.get("scaler")
    kmeans = clustering.get("kmeans")
    if not hasattr(model, "predict") or not hasattr(model, "predict_proba"):
        _runtime_error(version, "Material classifier is incompatible.")
    if not hasattr(scaler, "transform") or not hasattr(kmeans, "predict"):
        _runtime_error(version, "Material clustering estimator is incompatible.")

    X = adapt_ore(data)
    try:
        grade = str(model.predict(X)[0])
        probabilities = model.predict_proba(X)[0]
        classes = [str(item) for item in model.classes_]
        if set(classes) != {"low", "medium", "high"}:
            _runtime_error(version, "Material classifier class contract is incompatible.")
        if grade not in classes or grade not in {"low", "medium", "high"}:
            _runtime_error(version, "Material classifier returned an unknown class label.")
        probability = float(probabilities[classes.index(grade)])
        raw_cluster = kmeans.predict(scaler.transform(X))[0]
        if isinstance(raw_cluster, bool) or not isinstance(raw_cluster, (int, np.integer)):
            _runtime_error(version, "Material clustering returned a non-integer cluster id.")
        cluster_id = int(raw_cluster)
        cluster_count = clustering.get("n_clusters")
        if not isinstance(cluster_count, int) or cluster_count <= 0:
            _runtime_error(version, "Material clustering metadata is invalid.")
        if cluster_id < 0 or cluster_id >= cluster_count:
            _runtime_error(version, "Material clustering returned an out-of-range cluster id.")
    except ServiceError:
        raise
    except Exception as exc:  # noqa: BLE001
        mark_unready(version, "Material estimator call failed.")
        raise ServiceError("model_unavailable", "Material estimator call failed.", 503) from exc

    as_ratio = float(data["al2o3_pct"] / data["sio2_pct"])
    if as_ratio >= 6:
        threshold_grade = "high"
    elif as_ratio >= 4:
        threshold_grade = "medium"
    else:
        threshold_grade = "low"

    output = {
        "as_ratio": as_ratio,
        "threshold_grade": threshold_grade,
        "classifier_grade": grade,
        "classifier_probability": probability,
        "grade_disagreement": threshold_grade != grade,
        "cluster_id": cluster_id,
        "validation": {
            **VALIDATION_EVIDENCE["ore"],
        },
        "limitations": LIMITATIONS_TEXT["ore"],
    }
    return validate_ore_output(output)


def predict_alumina(data: dict, version: ModelVersion) -> dict:
    bundle = _bundle_for("alumina", version)
    pipeline = bundle.get("model")
    if not hasattr(pipeline, "predict"):
        _runtime_error(version, "Digestion estimator is incompatible.")

    try:
        raw = pipeline.predict(adapt_alumina(data))[0]
        if isinstance(raw, bool) or not isinstance(raw, (int, float, np.number)):
            _runtime_error(version, "Digestion estimator returned a non-numeric output.")
        raw_value = float(raw)
    except ServiceError:
        raise
    except Exception as exc:  # noqa: BLE001
        mark_unready(version, "Digestion estimator call failed.")
        raise ServiceError("model_unavailable", "Digestion estimator call failed.", 503) from exc
    efficiency = validate_alumina_output(raw_value)

    return {
        "digestion_efficiency_pct": efficiency,
        "unit": "percent",
        "validation": {
            **VALIDATION_EVIDENCE["alumina"],
        },
        "limitations": LIMITATIONS_TEXT["alumina"],
    }


def predict_secondary_metals(data: dict, version: ModelVersion) -> dict:
    bundle = _bundle_for("secondary_metals", version)
    feature_matrices = adapt_secondary_metals(data)

    raw_results = {}
    for element in ("Li", "Ga", "Sc"):
        element_bundle = bundle.get(element, {})
        model = element_bundle.get("model")
        if not hasattr(model, "predict"):
            _runtime_error(version, f"{element} estimator is incompatible.")
        try:
            raw = model.predict(feature_matrices[element])[0]
            if isinstance(raw, bool) or not isinstance(raw, (int, float, np.number)):
                _runtime_error(version, f"{element} estimator returned a non-numeric output.")
            raw_results[element] = float(raw)
        except ServiceError:
            raise
        except Exception as exc:  # noqa: BLE001
            mark_unready(version, f"{element} estimator call failed.")
            raise ServiceError("model_unavailable", f"{element} estimator call failed.", 503) from exc

    validated = validate_secondary_metals_output(raw_results)
    elements = {}
    for element in ("Li", "Ga", "Sc"):
        elements[element] = {
            "extraction_efficiency_pct": validated[element],
            "unit": "percent",
            "validation": {
                "method": VALIDATION_EVIDENCE["secondary_metals"]["method"],
                "unit": "percent",
                "element": element,
                "metrics": VALIDATION_EVIDENCE["secondary_metals"]["elements"][element],
                "note": VALIDATION_EVIDENCE["secondary_metals"]["note"],
            },
        }

    return {
        "elements": elements,
        "validation": {
            **VALIDATION_EVIDENCE["secondary_metals"],
        },
        "limitations": LIMITATIONS_TEXT["secondary_metals"],
    }


PREDICTORS = {"ore": predict_ore, "alumina": predict_alumina, "secondary_metals": predict_secondary_metals}


def run_prediction(kind: str, data: dict, version: ModelVersion) -> dict:
    validate_serving_input(kind, data)
    predictor = PREDICTORS.get(kind)
    if predictor is None:
        raise ServiceError("not_found", "Unknown analysis kind.", 404)
    return predictor(data, version)
