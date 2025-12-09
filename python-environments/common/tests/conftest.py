"""Shared pytest fixtures for ML server e2e tests."""

import json
import os
import signal
import socket
import subprocess
import time
from pathlib import Path

import httpx
import pytest

COMMON_DIR = Path(__file__).parent.parent
DATA_DIR = COMMON_DIR / "data"

TEST_IMAGES = {
    "badger": DATA_DIR / "badger.JPG",
    "fox": DATA_DIR / "fox1.JPG",
    "chamois": DATA_DIR / "chamois1.JPG",
    "empty": DATA_DIR / "empty1.JPG",
    "human": DATA_DIR / "human11.JPG",
    "vehicle": DATA_DIR / "vehicle.JPG",
}


def find_free_port() -> int:
    """Find an available port for the test server."""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("", 0))
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        return s.getsockname()[1]


def wait_for_server(url: str, timeout: float = 180.0, interval: float = 1.0) -> bool:
    """Wait for server to become healthy."""
    start = time.time()
    while time.time() - start < timeout:
        try:
            resp = httpx.get(f"{url}/health", timeout=5.0)
            if resp.status_code == 200:
                return True
        except httpx.ConnectError:
            pass
        time.sleep(interval)
    return False


class ServerProcess:
    """Context manager for running an ML server in a subprocess."""

    def __init__(self, command: list[str], port: int, startup_timeout: float = 180.0):
        self.command = command
        self.port = port
        self.startup_timeout = startup_timeout
        self.process = None
        self.base_url = f"http://localhost:{port}"

    def start(self):
        """Start the server subprocess."""
        env = os.environ.copy()
        self.process = subprocess.Popen(
            self.command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            cwd=str(COMMON_DIR),
        )
        if not wait_for_server(self.base_url, timeout=self.startup_timeout):
            self.stop()
            raise RuntimeError(f"Server failed to start on port {self.port}")
        return self

    def stop(self):
        """Stop the server subprocess gracefully."""
        if self.process:
            self.process.send_signal(signal.SIGTERM)
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                self.process.kill()
            self.process = None

    def __enter__(self):
        return self.start()

    def __exit__(self, *args):
        self.stop()


def parse_streaming_response(response: httpx.Response) -> list[dict]:
    """Parse newline-delimited JSON streaming response."""
    results = []
    for line in response.iter_lines():
        if line.strip():
            results.append(json.loads(line))
    return results


@pytest.fixture
def test_images() -> dict[str, Path]:
    """Provide test image paths."""
    return TEST_IMAGES


@pytest.fixture
def data_dir() -> Path:
    """Provide the data directory path."""
    return DATA_DIR
