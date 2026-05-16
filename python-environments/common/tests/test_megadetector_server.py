"""End-to-end tests for MegaDetector ML server."""

import os

import httpx
import pytest

from tests.conftest import ServerProcess, find_free_port, parse_streaming_response

MEGADETECTOR_DETECTOR_WEIGHTS = os.environ.get("MEGADETECTOR_DETECTOR_WEIGHTS", "")

pytestmark = pytest.mark.skipif(
    not MEGADETECTOR_DETECTOR_WEIGHTS,
    reason="MegaDetector weights not available. Set MEGADETECTOR_DETECTOR_WEIGHTS.",
)


@pytest.fixture(scope="module")
def megadetector_server():
    """Start MegaDetector server for the test module."""
    port = find_free_port()
    command = [
        "uv",
        "run",
        "python",
        "run_megadetector_server.py",
        "--port",
        str(port),
        "--timeout",
        "60",
        "--filepath-detector-weights",
        MEGADETECTOR_DETECTOR_WEIGHTS,
        "--detection-confidence-threshold",
        "0.2",
    ]
    with ServerProcess(command, port, startup_timeout=300) as server:
        yield server


class TestMegaDetectorServer:
    """Tests for MegaDetector server endpoints."""

    def test_health_endpoint(self, megadetector_server):
        resp = httpx.get(f"{megadetector_server.base_url}/health", timeout=10.0)
        assert resp.status_code == 200
        assert resp.text == "ok"

    def test_info_endpoint(self, megadetector_server):
        resp = httpx.get(f"{megadetector_server.base_url}/info", timeout=10.0)
        assert resp.status_code == 200
        data = resp.json()
        assert "model" in data
        assert data["model"]["type"] == "megadetector"
        assert "server" in data

    def test_predict_animal_image(self, megadetector_server, test_images):
        """A clearly-animal image should produce prediction='animal'."""
        payload = {"instances": [{"filepath": str(test_images["chamois"])}]}
        with httpx.stream(
            "POST",
            f"{megadetector_server.base_url}/predict",
            json=payload,
            timeout=60.0,
        ) as resp:
            assert resp.status_code == 200
            results = parse_streaming_response(resp)

        assert len(results) == 1
        pred = results[0]["output"]["predictions"][0]
        assert pred["filepath"] == str(test_images["chamois"])
        assert pred["prediction"] == "animal"
        assert pred["prediction_score"] >= 0.2
        assert pred["classifications"] == {}
        assert len(pred["detections"]) >= 1
        assert pred["detections"][0]["label"] in {"animal", "person", "vehicle"}
        assert "xywhn" in pred["detections"][0]

    def test_predict_human_image(self, megadetector_server, test_images):
        """A human image's top prediction should be 'homo sapiens' (translated from MD's 'person' label)."""
        payload = {"instances": [{"filepath": str(test_images["human"])}]}
        with httpx.stream(
            "POST",
            f"{megadetector_server.base_url}/predict",
            json=payload,
            timeout=60.0,
        ) as resp:
            results = parse_streaming_response(resp)
        pred = results[0]["output"]["predictions"][0]
        assert pred["prediction"] == "homo sapiens"
        # Raw bbox labels stay 'person' — MD's native output is preserved per-bbox.
        person_dets = [d for d in pred["detections"] if d["label"] == "person"]
        assert len(person_dets) >= 1, "raw 'person' label must be preserved per-detection"

    def test_predict_empty_image(self, megadetector_server, test_images):
        """An empty (no subject) image should produce prediction='blank'."""
        payload = {"instances": [{"filepath": str(test_images["empty"])}]}
        with httpx.stream(
            "POST",
            f"{megadetector_server.base_url}/predict",
            json=payload,
            timeout=60.0,
        ) as resp:
            results = parse_streaming_response(resp)
        pred = results[0]["output"]["predictions"][0]
        assert pred["prediction"] == "blank"
        assert pred["prediction_score"] is None

    def test_predict_streaming(self, megadetector_server, test_images):
        """Streaming returns one chunk per image, all classifications empty."""
        payload = {
            "instances": [
                {"filepath": str(test_images["badger"])},
                {"filepath": str(test_images["fox"])},
                {"filepath": str(test_images["empty"])},
            ]
        }
        with httpx.stream(
            "POST",
            f"{megadetector_server.base_url}/predict",
            json=payload,
            timeout=120.0,
        ) as resp:
            results = parse_streaming_response(resp)
        assert len(results) == 3
        for r in results:
            pred = r["output"]["predictions"][0]
            assert pred["classifications"] == {}
            assert pred["model_version"] == "6.0"

    def test_predict_invalid_filepath(self, megadetector_server):
        payload = {"instances": [{"filepath": "/nonexistent/image.jpg"}]}
        resp = httpx.post(
            f"{megadetector_server.base_url}/predict",
            json=payload,
            timeout=30.0,
        )
        assert resp.status_code in (200, 400)

    def test_docs_endpoint(self, megadetector_server):
        resp = httpx.get(f"{megadetector_server.base_url}/docs", timeout=10.0)
        assert resp.status_code == 200
        assert "swagger" in resp.text.lower() or "openapi" in resp.text.lower()
