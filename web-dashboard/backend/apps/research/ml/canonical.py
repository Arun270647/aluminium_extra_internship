import hashlib
import json
import math
from decimal import Decimal, InvalidOperation

from config.errors import ServiceError


def _validation_error(message: str):
    raise ServiceError("validation_error", message, 400)


def _canonical_number(value) -> str:
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        _validation_error("Numeric fields must use JSON numbers.")
    if isinstance(value, float) and not math.isfinite(value):
        _validation_error("Numeric fields must be finite.")
    try:
        number = Decimal(str(value))
    except InvalidOperation as exc:
        raise ServiceError("validation_error", "Numeric fields must be finite.", 400) from exc
    if not number.is_finite():
        _validation_error("Numeric fields must be finite.")
    if number == 0:
        return "0"
    token = format(number.normalize(), "f")
    if "." in token:
        token = token.rstrip("0").rstrip(".")
    return "0" if token in {"-0", "+0"} else token


def _encode(value) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if isinstance(value, (int, float, Decimal)):
        return _canonical_number(value)
    if isinstance(value, list):
        return "[" + ",".join(_encode(item) for item in value) + "]"
    if isinstance(value, dict):
        items = []
        for key in sorted(value):
            if not isinstance(key, str):
                _validation_error("Object keys must be strings.")
            items.append(json.dumps(key, ensure_ascii=False, separators=(",", ":")) + ":" + _encode(value[key]))
        return "{" + ",".join(items) + "}"
    _validation_error("Input contains unsupported value types.")


def request_hash(kind: str, schema_version: str, normalized_input: dict) -> str:
    envelope = {"kind": kind, "schema_version": schema_version, "input": normalized_input}
    canonical = _encode(envelope)
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()
