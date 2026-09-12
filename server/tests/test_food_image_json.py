"""Tests for food scan JSON extraction and normalization."""

from src.routes.calories import (
    _extract_gemini_response_text,
    _extract_json_object,
    _food_scan_model_candidates,
    _normalize_food_analysis_payload,
)


def test_extract_json_object_from_array_payload():
    raw = '[{"foodName":"Paneer Tikka","estimatedServingSize":"1 bowl","calories":320,"protein":24,"carbs":12,"fats":18,"fibre":3,"confidence":"high"}]'
    parsed = _extract_json_object(raw)
    assert parsed["foodName"] == "Paneer Tikka"


def test_extract_json_object_from_prose_wrapped_json():
    raw = 'Analysis complete.\n```json\n{"foodName":"Dal Rice","estimatedServingSize":"1 plate","calories":410,"protein":14,"carbs":68,"fats":8,"fibre":6,"confidence":"medium"}\n```'
    parsed = _extract_json_object(raw)
    assert parsed["foodName"] == "Dal Rice"


def test_extract_json_object_handles_trailing_commas():
    raw = '{"foodName":"Salad","estimatedServingSize":"1 bowl","calories":180,"protein":8,"carbs":20,"fats":6,"fibre":4,"confidence":"low",}'
    parsed = _extract_json_object(raw)
    assert parsed["foodName"] == "Salad"


def test_normalize_food_analysis_payload_accepts_snake_case():
    normalized = _normalize_food_analysis_payload(
        {
            "food_name": "Egg Curry",
            "estimated_serving_size": "1 katori",
            "calories": 260,
            "protein": 18,
            "carbs": 10,
            "fat": 16,
            "fiber": 2,
            "confidence": 0.9,
        }
    )
    assert normalized["foodName"] == "Egg Curry"
    assert normalized["estimatedServingSize"] == "1 katori"
    assert normalized["fats"] == 16.0
    assert normalized["fibre"] == 2.0
    assert normalized["confidence"] == "high"


def test_extract_gemini_response_text_joins_all_parts():
    payload = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {"text": '{"foodName":"Rice",'},
                        {"text": '"calories":200,"protein":4,"carbs":44,"fats":1,"fibre":1,"confidence":"medium","estimatedServingSize":"1 bowl"}'},
                    ]
                }
            }
        ]
    }
    raw = _extract_gemini_response_text(payload)
    parsed = _extract_json_object(raw)
    assert parsed["foodName"] == "Rice"


def test_food_scan_model_candidates_include_configured_primary():
    models = _food_scan_model_candidates()
    assert models
    assert models[0]
