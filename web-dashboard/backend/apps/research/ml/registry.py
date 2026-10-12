import hashlib
import importlib
import logging
import pickle
import sys
from pathlib import Path
from pickle import UnpicklingError
from threading import Lock

from django.conf import settings

from config.errors import ServiceError

from ..models import ModelVersion

logger = logging.getLogger(__name__)

_cache: dict[str, object] = {}
_runtime_unready: dict[str, str] = {}
_lock = Lock()

ARTIFACT_DIR = Path(getattr(settings, "ML_ARTIFACT_DIR", "")) if getattr(settings, "ML_ARTIFACT_DIR", "") else None

SCHEMA_VERSION = "1"
MANIFESTS = {
    "ore": {
        "artifact": "raw_material_analysis_models.pkl",
        "sha256": "c30260a3d48d9fb7be5aea9ba24ae37037b2827eabf7b3a4aab7e155dbb7fdfa",
        "adapter_version": "1.1",
        "runtime": {"scikit_learn": "1.6.1", "numpy_min": "1.26.0"},
    },
    "alumina": {
        "artifact": "alumina_digestion_model.pkl",
        "sha256": "23cc7e802e8997f079e23faa01ea2297af1925bc10f6137d128962cef86bcbde",
        "adapter_version": "1.1",
        "runtime": {"scikit_learn": "1.6.1", "numpy_min": "1.26.0"},
    },
    "secondary_metals": {
        "artifact": "secondary_metal_dissolution_models.pkl",
        "sha256": "53562367313c851c7c7fc6d65dd99f4d8de796ca0d49a25c233ca56928c644d1",
        "adapter_version": "1.0",
        "runtime": {"scikit_learn": "1.6.1", "numpy_min": "1.26.0"},
    },
}
EXPECTED_FEATURES = {
    "ore": 8,
    "alumina": 15,
    "secondary_metals": 6,
}


def _compute_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(4096), b""):
            h.update(block)
    return h.hexdigest()


def _version_token(version: ModelVersion) -> str:
    return f"{version.pk}:{version.sha256}:{version.adapter_version}"


def _manifest_token(kind: str) -> str:
    manifest = MANIFESTS.get(kind, {})
    return f"{kind}:{manifest.get('sha256', '')}:{manifest.get('adapter_version', '')}"


def _parse_version(raw: str) -> tuple[int, ...]:
    parts = []
    for item in raw.split("."):
        digits = []
        for char in item:
            if char.isdigit():
                digits.append(char)
            else:
                break
        parts.append(int("".join(digits)) if digits else 0)
    return tuple(parts)


def _runtime_versions() -> dict[str, str]:
    try:
        numpy = importlib.import_module("numpy")
        pandas = importlib.import_module("pandas")
        scipy = importlib.import_module("scipy")
        sklearn = importlib.import_module("sklearn")
    except ImportError as exc:
        raise ServiceError("model_unavailable", "Scientific runtime dependencies are missing.", 503) from exc
    return {"python": sys.version.split()[0], "numpy": numpy.__version__, "pandas": pandas.__version__, "scipy": scipy.__version__,
            "scikit_learn": sklearn.__version__}


def _runtime_compatible(kind: str) -> bool:
    versions = _runtime_versions()
    manifest = MANIFESTS.get(kind, {})
    runtime = manifest.get("runtime", {})
    if not versions["python"].startswith("3.12."):
        return False
    if versions["scikit_learn"] != runtime.get("scikit_learn"):
        return False
    return (_parse_version(runtime.get("numpy_min", "0.0.0"))
            <= _parse_version(versions["numpy"]) < (2, 0, 0)
            and (2, 0, 0) <= _parse_version(versions["pandas"]) < (3, 0, 0))


def _artifact_path(kind: str) -> Path:
    if ARTIFACT_DIR is None:
        raise ServiceError("model_unavailable", "ML artifacts are not configured.", 503)
    manifest = MANIFESTS.get(kind)
    if manifest is None:
        raise ServiceError("not_found", "Unknown analysis kind.", 404)
    path = ARTIFACT_DIR / manifest["artifact"]
    if not path.exists():
        raise ServiceError("model_unavailable", "Model artifact is unavailable on this worker.", 503)
    if not path.is_file():
        raise ServiceError("model_unavailable", "Artifact path is not a file.", 503)
    return path


def _validate_artifact_interface(kind: str, artifact: object):
    if not isinstance(artifact, dict):
        raise ServiceError("model_unavailable", "Model artifact has an invalid structure.", 503)
    if kind == "ore":
        classifier = artifact.get("ore_grade_classifier", {})
        clustering = artifact.get("clustering", {})
        if not isinstance(classifier, dict) or not isinstance(clustering, dict):
            raise ServiceError("model_unavailable", "Material artifact interface is invalid.", 503)
        model = classifier.get("model")
        feature_names = classifier.get("feature_names")
        scaler = clustering.get("scaler")
        kmeans = clustering.get("kmeans")
        if not isinstance(feature_names, list) or len(feature_names) != EXPECTED_FEATURES["ore"]:
            raise ServiceError("model_unavailable", "Material classifier feature contract is invalid.", 503)
        # use the estimator's class order for probabilities
        classes = list(getattr(model, "classes_", []))
        if len(classes) != 3 or set(classes) != {"low", "medium", "high"}:
            raise ServiceError("model_unavailable", "Material classifier labels are incompatible.", 503)
        if not hasattr(model, "predict") or not hasattr(model, "predict_proba"):
            raise ServiceError("model_unavailable", "Material classifier interface is invalid.", 503)
        if not hasattr(scaler, "transform") or not hasattr(kmeans, "predict"):
            raise ServiceError("model_unavailable", "Material clustering interface is invalid.", 503)
        if clustering.get("n_clusters") != 4:
            raise ServiceError("model_unavailable", "Material clustering contract is invalid.", 503)
        return
    if kind == "alumina":
        model = artifact.get("model")
        feature_names = artifact.get("feature_names")
        if not isinstance(feature_names, list) or len(feature_names) != EXPECTED_FEATURES["alumina"]:
            raise ServiceError("model_unavailable", "Digestion feature contract is invalid.", 503)
        if not hasattr(model, "predict"):
            raise ServiceError("model_unavailable", "Digestion model interface is invalid.", 503)
        if artifact.get("training_n") != 55:
            raise ServiceError("model_unavailable", "Digestion metadata contract is invalid.", 503)
        return
    if kind == "secondary_metals":
        for element in ("Li", "Ga", "Sc"):
            element_bundle = artifact.get(element, {})
            if not isinstance(element_bundle, dict):
                raise ServiceError("model_unavailable", "Recovery model bundle is invalid.", 503)
            model = element_bundle.get("model")
            feature_names = element_bundle.get("feature_names")
            if not isinstance(feature_names, list) or len(feature_names) != EXPECTED_FEATURES["secondary_metals"]:
                raise ServiceError("model_unavailable", f"{element} feature contract is invalid.", 503)
            if not isinstance(element_bundle.get("n_train"), int) or element_bundle["n_train"] <= 0:
                raise ServiceError("model_unavailable", f"{element} training metadata is invalid.", 503)
            if not hasattr(model, "predict"):
                raise ServiceError("model_unavailable", f"{element} model interface is invalid.", 503)
        return
    raise ServiceError("not_found", "Unknown analysis kind.", 404)


def _load_artifact(kind: str, token: str, *, force_reload: bool = False) -> object:
    manifest = MANIFESTS.get(kind)
    if manifest is None:
        raise ServiceError("not_found", "Unknown analysis kind.", 404)
    if not _runtime_compatible(kind):
        raise ServiceError("model_unavailable", "Runtime does not match reviewed model dependencies.", 503)
    if force_reload:
        with _lock:
            _cache.pop(token, None)
        _runtime_unready.pop(token, None)
    if token in _runtime_unready:
        raise ServiceError("model_unavailable", "This worker marked the model runtime unavailable.", 503)
    if token in _cache:
        return _cache[token]

    try:
        path = _artifact_path(kind)
        actual_hash = _compute_sha256(path)
        if actual_hash != manifest["sha256"]:
            raise ServiceError("model_unavailable", "Model artifact digest mismatch.", 503)

        with _lock:
            if token in _cache:
                return _cache[token]
            with open(path, "rb") as handle:
                artifact = pickle.load(handle)
            _validate_artifact_interface(kind, artifact)
            _cache[token] = artifact
            logger.info("Loaded %s artifact from %s", kind, path)
            return artifact
    except ServiceError:
        raise
    except (OSError, ValueError, TypeError, KeyError, UnpicklingError) as exc:
        logger.error("Artifact load failed for %s: %s", kind, type(exc).__name__)
        raise ServiceError("model_unavailable", "Model artifact could not be loaded safely.", 503) from exc
    except Exception as exc:  # noqa: BLE001
        logger.error("Unexpected artifact load failure for %s: %s", kind, type(exc).__name__)
        raise ServiceError("model_unavailable", "Model artifact could not be loaded safely.", 503) from exc


def enabled_version(kind: str) -> ModelVersion | None:
    return (ModelVersion.objects.filter(kind=kind, status="enabled")
            .order_by("-verified_at", "-created_at", "-id")
            .first())


def mark_unready(version: ModelVersion, reason: str):
    token = _version_token(version)
    _runtime_unready[token] = reason
    logger.error("Model runtime marked unavailable for %s: %s", token, reason)


def verify_manifest(kind: str, *, force_reload: bool = True) -> dict:
    manifest = MANIFESTS.get(kind)
    if manifest is None:
        raise ServiceError("not_found", "Analysis not found.", 404)
    artifact = _load_artifact(kind, _manifest_token(kind), force_reload=force_reload)
    _validate_artifact_interface(kind, artifact)
    return {
        "artifact_name": manifest["artifact"],
        "sha256": manifest["sha256"],
        "adapter_version": manifest["adapter_version"],
        "schema_version": SCHEMA_VERSION,
        "runtime": _runtime_versions(),
    }


def load_artifact_for_version(version: ModelVersion, *, force_reload: bool = False) -> object:
    manifest = MANIFESTS.get(version.kind)
    if manifest is None:
        raise ServiceError("not_found", "Unknown analysis kind.", 404)
    if version.sha256 != manifest["sha256"] or version.adapter_version != manifest["adapter_version"]:
        raise ServiceError("model_unavailable", "Enabled version does not match the trusted manifest.", 503)
    if version.schema_version != SCHEMA_VERSION:
        raise ServiceError("model_unavailable", "Enabled version schema is incompatible.", 503)
    return _load_artifact(version.kind, _version_token(version), force_reload=force_reload)


def clear_cache():
    with _lock:
        _cache.clear()
    _runtime_unready.clear()
