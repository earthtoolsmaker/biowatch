"""Unit tests for shared ML server utilities."""

from unittest.mock import MagicMock, patch

import pytest

from utils import VideoCapableLitAPI, get_video_metadata


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


class TestGetVideoMetadataSanity:
    """Tests that get_video_metadata rejects corrupt-file metadata.

    OpenCV can return huge negative frame_count values on broken containers
    (uint64 underflow cast to int), producing absurd durations and letting a
    single garbage frame slip into inference. The metadata helper rejects
    these so the consumer's error-handling pipeline can flag the file.
    """

    def _mocked_capture(self, fps, frame_count, opened=True):
        cap = MagicMock()
        cap.isOpened.return_value = opened
        cap.get.side_effect = lambda prop: {
            5: fps,  # cv2.CAP_PROP_FPS
            7: frame_count,  # cv2.CAP_PROP_FRAME_COUNT
        }.get(prop, 0)
        return cap

    def test_rejects_negative_frame_count(self):
        """A corrupt MP4 with negative frame_count must raise, not return junk."""
        with (
            patch(
                "utils.cv2.VideoCapture",
                return_value=self._mocked_capture(fps=30, frame_count=-922337203685477),
            ),
            pytest.raises(ValueError, match="Invalid video metadata"),
        ):
            get_video_metadata("/corrupt.mp4")

    def test_rejects_zero_frame_count(self):
        """A file that reports zero frames is not a usable video."""
        with (
            patch(
                "utils.cv2.VideoCapture",
                return_value=self._mocked_capture(fps=30, frame_count=0),
            ),
            pytest.raises(ValueError, match="Invalid video metadata"),
        ):
            get_video_metadata("/empty.mp4")

    def test_rejects_zero_fps(self):
        """fps=0 means duration is meaningless."""
        with (
            patch(
                "utils.cv2.VideoCapture",
                return_value=self._mocked_capture(fps=0, frame_count=100),
            ),
            pytest.raises(ValueError, match="Invalid video metadata"),
        ):
            get_video_metadata("/no-fps.mp4")

    def test_rejects_excessive_duration(self):
        """Duration above the 24h sanity ceiling is rejected."""
        # 30 fps × 30 hours of frames → 30h duration → over the 24h limit.
        excessive_frame_count = 30 * 60 * 60 * 30
        with (
            patch(
                "utils.cv2.VideoCapture",
                return_value=self._mocked_capture(fps=30, frame_count=excessive_frame_count),
            ),
            pytest.raises(ValueError, match="Invalid video metadata"),
        ):
            get_video_metadata("/huge.mp4")

    def test_rejects_unopenable_video(self):
        """Cannot open returns the existing 'Cannot open video' error."""
        with (
            patch(
                "utils.cv2.VideoCapture",
                return_value=self._mocked_capture(fps=30, frame_count=100, opened=False),
            ),
            pytest.raises(ValueError, match="Cannot open video"),
        ):
            get_video_metadata("/missing.mp4")

    def test_accepts_normal_video(self):
        """Sane metadata round-trips through."""
        with patch("utils.cv2.VideoCapture", return_value=self._mocked_capture(fps=30, frame_count=300)):
            metadata = get_video_metadata("/ok.mp4")
        assert metadata["fps"] == 30
        assert metadata["duration"] == pytest.approx(10.0)  # 300 frames / 30 fps
