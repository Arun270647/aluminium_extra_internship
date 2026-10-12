import numpy as np

from config.errors import ServiceError


def validate_ore_output(prediction_data: dict) -> dict:
    as_ratio = prediction_data.get("as_ratio")
    if as_ratio is None or not np.isfinite(as_ratio) or as_ratio <= 0:
        raise ServiceError("model_output_out_of_range", "Model produced invalid A/S ratio.", 422)

    prob = prediction_data.get("classifier_probability")
    if prob is None or not np.isfinite(prob) or prob < 0 or prob > 1:
        raise ServiceError("model_output_out_of_range", "Invalid classifier probability.", 422)

    return prediction_data


def validate_alumina_output(value: float) -> float:
    if not np.isfinite(value) or value < 0 or value > 100:
        raise ServiceError("model_output_out_of_range", f"Digestion efficiency {value} outside valid range [0, 100].", 422)
    return round(float(value), 4)


def validate_secondary_metals_output(element_results: dict[str, float]) -> dict[str, float]:
    for element, value in element_results.items():
        if not np.isfinite(value) or value < 0 or value > 100:
            raise ServiceError(
                "model_output_out_of_range",
                f"{element} extraction efficiency {value} outside valid range [0, 100].",
                422,
            )
    return {k: round(float(v), 4) for k, v in element_results.items()}
