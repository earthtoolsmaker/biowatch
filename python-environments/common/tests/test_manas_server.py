"""End-to-end tests for Manas ML server."""

import os

import httpx
import pytest

from tests.conftest import ServerProcess, find_free_port, parse_streaming_response

# Model paths from environment variables
MANAS_DETECTOR_WEIGHTS = os.environ.get("MANAS_DETECTOR_WEIGHTS", "")
MANAS_CLASSIFIER_WEIGHTS = os.environ.get("MANAS_CLASSIFIER_WEIGHTS", "")
MANAS_CLASSES = os.environ.get("MANAS_CLASSES", "")

# Skip all tests if weights are not available
pytestmark = pytest.mark.skipif(
    not MANAS_DETECTOR_WEIGHTS or not MANAS_CLASSIFIER_WEIGHTS or not MANAS_CLASSES,
    reason="Manas weights not available. Set MANAS_DETECTOR_WEIGHTS, MANAS_CLASSIFIER_WEIGHTS, and MANAS_CLASSES.",
)


@pytest.fixture(scope="module")
def manas_server():
    """Start Manas server for the test module."""
    port = find_free_port()
    command = [
        "uv",
        "run",
        "python",
        "run_manas_server.py",
        "--port",
        str(port),
        "--timeout",
        "60",
        "--filepath-detector-weights",
        MANAS_DETECTOR_WEIGHTS,
        "--filepath-classifier-weights",
        MANAS_CLASSIFIER_WEIGHTS,
        "--filepath-classes",
        MANAS_CLASSES,
    ]
    with ServerProcess(command, port, startup_timeout=300) as server:
        yield server


class TestManasServer:
    """Tests for Manas server endpoints."""

    def test_health_endpoint(self, manas_server):
        """Test /health returns ok."""
        resp = httpx.get(f"{manas_server.base_url}/health", timeout=10.0)
        assert resp.status_code == 200
        assert resp.text == "ok"

    def test_info_endpoint(self, manas_server):
        """Test /info returns model metadata."""
        resp = httpx.get(f"{manas_server.base_url}/info", timeout=10.0)
        assert resp.status_code == 200
        data = resp.json()
        assert "model" in data
        assert data["model"]["type"] == "manas"
        assert "server" in data

    def test_predict_single_image(self, manas_server, test_images):
        """Test /predict with a single image."""
        payload = {"instances": [{"filepath": str(test_images["fox"])}]}
        with httpx.stream(
            "POST",
            f"{manas_server.base_url}/predict",
            json=payload,
            timeout=60.0,
        ) as resp:
            assert resp.status_code == 200
            results = parse_streaming_response(resp)

        assert len(results) == 1
        assert "output" in results[0]
        assert "predictions" in results[0]["output"]
        pred = results[0]["output"]["predictions"][0]
        assert pred["filepath"] == str(test_images["fox"])
        assert "prediction" in pred
        assert "prediction_score" in pred

    def test_predict_multiple_images(self, manas_server, test_images):
        """Test /predict with multiple images (streaming)."""
        payload = {
            "instances": [
                {"filepath": str(test_images["badger"])},
                {"filepath": str(test_images["fox"])},
                {"filepath": str(test_images["chamois"])},
            ]
        }
        with httpx.stream(
            "POST",
            f"{manas_server.base_url}/predict",
            json=payload,
            timeout=120.0,
        ) as resp:
            assert resp.status_code == 200
            results = parse_streaming_response(resp)

        assert len(results) == 3
        filepaths = [r["output"]["predictions"][0]["filepath"] for r in results]
        assert str(test_images["badger"]) in filepaths
        assert str(test_images["fox"]) in filepaths
        assert str(test_images["chamois"]) in filepaths

    def test_predict_invalid_filepath(self, manas_server):
        """Test /predict with non-existent file handles error gracefully."""
        payload = {"instances": [{"filepath": "/nonexistent/image.jpg"}]}
        resp = httpx.post(
            f"{manas_server.base_url}/predict",
            json=payload,
            timeout=30.0,
        )
        # Server should return either 400 error or empty/error response for invalid paths
        assert resp.status_code in (200, 400)

    def test_docs_endpoint(self, manas_server):
        """Test /docs Swagger UI is available."""
        resp = httpx.get(f"{manas_server.base_url}/docs", timeout=10.0)
        assert resp.status_code == 200
        assert "swagger" in resp.text.lower() or "openapi" in resp.text.lower()
