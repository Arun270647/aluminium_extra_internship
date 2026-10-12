import math

import numpy as np

from config.errors import ServiceError

ORE_FIELDS = ["al2o3_pct", "sio2_pct", "fe2o3_pct", "tio2_pct", "cao_pct", "mgo_pct", "k2o_pct", "na2o_pct"]
SILICA_MINIMUM = 0.001
ALUMINA_MODES = {
    "roasting": ["roasting_temperature_c", "roasting_time_min"],
    "lime": ["lime_pct"],
    "caustic": ["na2ok_g_l"],
    "digestion_temperature": ["digestion_temperature_c"],
    "digestion_time": ["digestion_time_min"],
}
SECONDARY_MODES = {"roasting": [], "lime": ["lime_pct"], "temperature": ["digestion_temperature_c"]}
ALUMINA_CONDITION_KEYS = ["roasting_temperature_c", "roasting_time_min", "lime_pct", "na2ok_g_l",
                          "digestion_temperature_c", "digestion_time_min"]
SECONDARY_CONDITION_KEYS = ["lime_pct", "digestion_temperature_c"]


def _shape_error(message: str):
    raise ServiceError("validation_error", message, 400)


def _domain_error(message: str):
    raise ServiceError("unsupported_input", message, 422)


def _expect_object(data, field_name: str):
    if not isinstance(data, dict):
        _shape_error(f"{field_name} must be a JSON object.")
    return data


def _reject_unknown(data: dict, allowed: set[str], field_name: str):
    unknown = sorted(set(data) - allowed)
    if unknown:
        _shape_error(f"{field_name} contains unsupported fields: {', '.join(unknown)}.")


def _norm_number(value: float):
    if value == 0:
        return 0
    if float(value).is_integer():
        return int(value)
    return float(value)


def _read_number(data: dict, key: str, *, required: bool = True):
    if key not in data:
        if required:
            _shape_error(f"Field {key} is required.")
        return None
    value = data[key]
    if value is None:
        if required:
            _shape_error(f"Field {key} is required.")
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        _shape_error(f"Field {key} must be a number.")
    try:
        value = float(value)
    except OverflowError:
        _domain_error(f"Field {key} must be finite.")
    if not math.isfinite(value):
        _domain_error(f"Field {key} must be finite.")
    return value


def _check_range(value: float, key: str, *, min_value=None, max_value=None):
    if min_value is not None and value < min_value:
        _domain_error(f"Field {key} must be greater than or equal to {min_value}.")
    if max_value is not None and value > max_value:
        _domain_error(f"Field {key} must be less than or equal to {max_value}.")


def normalize_ore_input(data: dict) -> dict:
    data = _expect_object(data, "Input")
    _reject_unknown(data, set(ORE_FIELDS), "Input")
    normalized = {}
    for field in ORE_FIELDS:
        value = _read_number(data, field)
        _check_range(value, field, min_value=0, max_value=100)
        normalized[field] = _norm_number(value)
    if normalized["sio2_pct"] <= 0:
        _domain_error("SiO₂ must be greater than 0.")
    total = sum(float(normalized[field]) for field in ORE_FIELDS)
    if total > 100:
        _domain_error("Total oxide percentage must be less than or equal to 100.")
    return normalized


def normalize_alumina_input(data: dict) -> dict:
    data = _expect_object(data, "Input")
    _reject_unknown(data, {"feed_type", "al2o3_pct", "sio2_pct", "experiment_mode", "conditions"}, "Input")

    feed_type = data.get("feed_type")
    if not isinstance(feed_type, str):
        _shape_error("feed_type must be a string.")
    if feed_type not in ("roasted", "unroasted"):
        _domain_error("feed_type must be roasted or unroasted.")

    mode = data.get("experiment_mode")
    if not isinstance(mode, str):
        _shape_error("experiment_mode must be a string.")
    if mode not in ALUMINA_MODES:
        _domain_error("experiment_mode is not supported.")

    al2o3 = _read_number(data, "al2o3_pct")
    sio2 = _read_number(data, "sio2_pct")
    _check_range(al2o3, "al2o3_pct", min_value=0, max_value=100)
    _check_range(sio2, "sio2_pct", min_value=0, max_value=100)
    if sio2 <= 0:
        _domain_error("SiO₂ must be greater than 0.")
    if al2o3 + sio2 > 100:
        _domain_error("al2o3_pct + sio2_pct must be less than or equal to 100.")

    raw_conditions = data.get("conditions", {})
    if raw_conditions is None:
        raw_conditions = {}
    raw_conditions = _expect_object(raw_conditions, "conditions")
    _reject_unknown(raw_conditions, set(ALUMINA_CONDITION_KEYS), "conditions")

    conditions = {}
    for key in ALUMINA_CONDITION_KEYS:
        value = _read_number(raw_conditions, key, required=False)
        if value is None:
            continue
        if key == "lime_pct":
            _check_range(value, key, min_value=0, max_value=100)
        else:
            _check_range(value, key, min_value=0)
        conditions[key] = _norm_number(value)

    applicable = set(ALUMINA_MODES[mode])
    if feed_type == "unroasted" and mode == "roasting" and not conditions:
        applicable = set()
    for key in ALUMINA_CONDITION_KEYS:
        has_value = key in conditions
        if key in applicable and not has_value:
            _domain_error(f"Condition {key} is required for mode {mode}.")
        if key not in applicable and has_value:
            _domain_error(f"Condition {key} is not applicable for mode {mode}.")

    return {
        "feed_type": feed_type,
        "al2o3_pct": _norm_number(al2o3),
        "sio2_pct": _norm_number(sio2),
        "experiment_mode": mode,
        "conditions": {key: conditions[key] for key in ALUMINA_MODES[mode] if key in applicable},
    }


def normalize_secondary_metals_input(data: dict) -> dict:
    data = _expect_object(data, "Input")
    _reject_unknown(data, {"bauxite_concentrations_ug_g", "experiment_mode", "conditions"}, "Input")

    mode = data.get("experiment_mode")
    if not isinstance(mode, str):
        _shape_error("experiment_mode must be a string.")
    if mode not in SECONDARY_MODES:
        _domain_error("experiment_mode must be roasting, lime, or temperature.")

    concentrations = _expect_object(data.get("bauxite_concentrations_ug_g"), "bauxite_concentrations_ug_g")
    _reject_unknown(concentrations, {"Li", "Ga", "Sc"}, "bauxite_concentrations_ug_g")
    normalized_concentrations = {}
    for element in ("Li", "Ga", "Sc"):
        value = _read_number(concentrations, element)
        _check_range(value, element, min_value=0)
        normalized_concentrations[element] = _norm_number(value)

    raw_conditions = data.get("conditions", {})
    if raw_conditions is None:
        raw_conditions = {}
    raw_conditions = _expect_object(raw_conditions, "conditions")
    _reject_unknown(raw_conditions, set(SECONDARY_CONDITION_KEYS), "conditions")

    conditions = {}
    for key in SECONDARY_CONDITION_KEYS:
        value = _read_number(raw_conditions, key, required=False)
        if value is None:
            continue
        if key == "lime_pct":
            _check_range(value, key, min_value=0, max_value=100)
        else:
            _check_range(value, key, min_value=0)
        conditions[key] = _norm_number(value)

    applicable = set(SECONDARY_MODES[mode])
    for key in SECONDARY_CONDITION_KEYS:
        has_value = key in conditions
        if key in applicable and not has_value:
            _domain_error(f"Condition {key} is required for mode {mode}.")
        if key not in applicable and has_value:
            _domain_error(f"Condition {key} is not applicable for mode {mode}.")

    return {
        "bauxite_concentrations_ug_g": normalized_concentrations,
        "experiment_mode": mode,
        "conditions": {key: conditions[key] for key in SECONDARY_MODES[mode]},
    }


def normalize_input(kind: str, data: dict) -> dict:
    if kind == "ore":
        return normalize_ore_input(data)
    if kind == "alumina":
        return normalize_alumina_input(data)
    if kind == "secondary_metals":
        return normalize_secondary_metals_input(data)
    raise ServiceError("not_found", "Analysis not found.", 404)


def validate_serving_input(kind: str, data: dict):
    if kind in {"ore", "alumina"} and data["sio2_pct"] < SILICA_MINIMUM:
        raise ServiceError(
            "unsupported_input", "Silica must be at least 0.001 wt%.", 422,
            fields={"sio2_pct": ["Enter at least 0.001 wt% silica."]},
        )


def adapt_ore(data: dict) -> np.ndarray:
    return np.array([[float(data[field]) for field in ORE_FIELDS]], dtype=float)


def adapt_alumina(data: dict) -> np.ndarray:
    conditions = data.get("conditions") or {}
    mode = data["experiment_mode"]
    mode_keys = ALUMINA_MODES
    required = mode_keys.get(mode, [])
    if data["feed_type"] == "unroasted" and mode == "roasting" and not conditions:
        required = []
    for key in required:
        if key not in conditions:
            _domain_error(f"Condition {key} is required for mode {mode}.")
    is_roasted = 1 if data["feed_type"] == "roasted" else 0
    al2o3 = float(data["al2o3_pct"])
    sio2 = float(data["sio2_pct"])

    def pv(key):
        if key in conditions:
            return 1, float(conditions[key])
        return 0, 0.0

    fp_rt, fv_rt = pv("roasting_temperature_c")
    fp_rtm, fv_rtm = pv("roasting_time_min")
    fp_lime, fv_lime = pv("lime_pct")
    fp_na2ok, fv_na2ok = pv("na2ok_g_l")
    fp_dt, fv_dt = pv("digestion_temperature_c")
    fp_dtm, fv_dtm = pv("digestion_time_min")

    features = [
        is_roasted, al2o3, sio2,
        fp_rt, fv_rt, fp_rtm, fv_rtm,
        fp_lime, fv_lime,
        fp_na2ok, fv_na2ok,
        fp_dt, fv_dt,
        fp_dtm, fv_dtm,
    ]
    return np.array([features], dtype=float)


def adapt_secondary_metals(data: dict) -> dict[str, np.ndarray]:
    concentrations = data["bauxite_concentrations_ug_g"]
    mode = data["experiment_mode"]
    conditions = data.get("conditions") or {}

    is_roasting = 1 if mode == "roasting" else 0
    is_lime = 1 if mode == "lime" else 0
    is_temperature = 1 if mode == "temperature" else 0
    lime_pct = float(conditions["lime_pct"]) if mode == "lime" else 0.0
    temperature_c = float(conditions["digestion_temperature_c"]) if mode == "temperature" else 0.0

    result = {}
    for element in ("Li", "Ga", "Sc"):
        conc = float(concentrations[element])
        result[element] = np.array([[conc, is_roasting, is_lime, is_temperature, lime_pct, temperature_c]],
                                   dtype=float)
    return result
