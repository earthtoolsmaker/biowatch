"""Unit tests for shared ML server utilities."""

from utils import VideoCapableLitAPI


class TestNormalizeFailedPredictions:
    """Tests for VideoCapableLitAPI._normalize_failed_predictions.

    SpeciesNet returns partial-failure predictions with a `failures` field but
    no `prediction` field when an image cannot be loaded (e.g. corrupt JPEG).
    Downstream JS validation requires `prediction` to be a string, so we
    rewrite those records into a standard error prediction before yielding.
    """

    def test_normalizes_partial_failure_to_error(self):
        """A prediction with `failures` and no `prediction` is rewritten."""
        result = {
            "predictions": [
                {
                    "filepath": "/corrupt.jpg",
                    "failures": ["CLASSIFIER", "DETECTOR"],
                    "model_version": "4.0.1a",
                }
            ]
        }
        normalized = VideoCapableLitAPI._normalize_failed_predictions(result, "/corrupt.jpg")
        assert len(normalized["predictions"]) == 1
        pred = normalized["predictions"][0]
        assert pred["filepath"] == "/corrupt.jpg"
        assert pred["prediction"] == "error"
        assert pred["prediction_score"] == 0.0
        assert pred["classifications"] == {}
        assert pred["detections"] == []
        assert pred["model_version"] == "4.0.1a"
        assert "CLASSIFIER" in pred["error"]
        assert "DETECTOR" in pred["error"]

    def test_preserves_successful_prediction(self):
        """A normal prediction with `prediction` field is passed through unchanged."""
        result = {
            "predictions": [
                {
                    "filepath": "/animal.jpg",
                    "prediction": "uuid;mammalia;carnivora;felidae;panthera;leo;lion",
                    "prediction_score": 0.95,
                    "model_version": "4.0.1a",
                    "classifications": {"classes": ["uuid;..."], "scores": [0.95]},
                    "detections": [{"category": "1", "label": "animal", "conf": 0.99}],
                }
            ]
        }
        normalized = VideoCapableLitAPI._normalize_failed_predictions(result, "/animal.jpg")
        assert normalized["predictions"][0] == result["predictions"][0]

    def test_falls_back_to_provided_filepath(self):
        """When the failed prediction lacks `filepath`, fallback is used."""
        result = {"predictions": [{"failures": ["CLASSIFIER"]}]}
        normalized = VideoCapableLitAPI._normalize_failed_predictions(result, "/fallback.jpg")
        assert normalized["predictions"][0]["filepath"] == "/fallback.jpg"

    def test_handles_unknown_model_version(self):
        """When the failed prediction lacks `model_version`, fallback is 'unknown'."""
        result = {"predictions": [{"filepath": "/x.jpg", "failures": ["CLASSIFIER"]}]}
        normalized = VideoCapableLitAPI._normalize_failed_predictions(result, "/x.jpg")
        assert normalized["predictions"][0]["model_version"] == "unknown"

    def test_mixed_batch(self):
        """A batch with both successful and failed predictions is partially rewritten."""
        result = {
            "predictions": [
                {
                    "filepath": "/ok.jpg",
                    "prediction": "blank",
                    "prediction_score": 0.5,
                    "model_version": "4.0.1a",
                },
                {
                    "filepath": "/bad.jpg",
                    "failures": ["CLASSIFIER", "DETECTOR"],
                    "model_version": "4.0.1a",
                },
            ]
        }
        normalized = VideoCapableLitAPI._normalize_failed_predictions(result, "/fallback.jpg")
        assert normalized["predictions"][0]["prediction"] == "blank"
        assert normalized["predictions"][1]["prediction"] == "error"

    def test_empty_predictions(self):
        """Empty predictions list is handled."""
        result = {"predictions": []}
        normalized = VideoCapableLitAPI._normalize_failed_predictions(result, "/x.jpg")
        assert normalized == {"predictions": []}

    def test_missing_predictions_key(self):
        """Result without `predictions` key returns empty list."""
        result = {}
        normalized = VideoCapableLitAPI._normalize_failed_predictions(result, "/x.jpg")
        assert normalized == {"predictions": []}
