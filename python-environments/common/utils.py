"""Shared utilities for Biowatch ML servers.

This module provides:
- safe_imread: Read images safely with non-ASCII path support
- Video handling: frame extraction, metadata retrieval, and a mixin class
  for adding video support to LitServe APIs.
"""

import logging
import os
import tempfile
from abc import ABC, abstractmethod
from collections.abc import Generator
from pathlib import Path
from typing import Any

import cv2
import numpy as np

# Configure logging for diagnostic output
logger = logging.getLogger(__name__)

# Video file extensions supported by Biowatch
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".mov", ".webm", ".avi", ".m4v"}


def safe_imread(filepath):
    """Read an image from a file path that may contain non-ASCII characters.

    Uses np.fromfile + cv2.imdecode to bypass OpenCV's ASCII-only path limitation.

    Args:
        filepath: Path to the image file.

    Returns:
        numpy.ndarray: The image in BGR format.

    Raises:
        ValueError: If the image cannot be decoded.
    """
    filepath_str = str(filepath)
    if not filepath_str.strip():
        raise ValueError(f"Empty filepath provided: {filepath_str!r}")
    data = np.fromfile(filepath_str, dtype=np.uint8)
    image = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Cannot decode image: {filepath_str!r}")
    return image


def is_video_file(filepath: str) -> bool:
    """
    Check if a file is a video based on its extension.

    Args:
        filepath: Path to the file

    Returns:
        True if the file has a video extension, False otherwise
    """
    return Path(filepath).suffix.lower() in VIDEO_EXTENSIONS


def get_video_metadata(video_path: str) -> dict[str, float]:
    """
    Extract video metadata (duration and FPS) using OpenCV.

    Args:
        video_path: Path to the video file

    Returns:
        Dictionary with 'fps' and 'duration' keys
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = frame_count / fps if fps > 0 else 0
    cap.release()

    return {"fps": fps, "duration": duration}


def extract_frames_at_fps(video_path: str, target_fps: int = 1) -> Generator[tuple[int, Any], None, None]:
    """
    Extract frames from a video at a specified sampling rate.

    Args:
        video_path: Path to the video file
        target_fps: Target frames per second for extraction (default: 1)

    Yields:
        Tuples of (frame_number, frame_bgr) where frame_number is the
        index of the extracted frame (0-based) and frame_bgr is the
        frame as a numpy array in BGR format.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {video_path}")

    original_fps = cap.get(cv2.CAP_PROP_FPS)
    if original_fps <= 0:
        cap.release()
        raise ValueError(f"Invalid FPS for video: {video_path}")

    # Calculate frame interval for target FPS
    frame_interval = max(1, int(original_fps / target_fps))

    frame_idx = 0
    extracted_count = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        if frame_idx % frame_interval == 0:
            yield (extracted_count, frame)
            extracted_count += 1

        frame_idx += 1

    cap.release()


class VideoCapableLitAPI(ABC):
    """
    Mixin class providing video handling for LitAPI subclasses.

    This mixin adds video support to any LitServe API by automatically
    detecting video files and processing them frame by frame. Subclasses
    must implement `_predict_single_image(filepath, **kwargs)` to handle
    the actual model inference on individual frames.

    Usage:
        class MyModelLitAPI(ls.LitAPI, VideoCapableLitAPI):
            def _predict_single_image(self, filepath: str, **kwargs) -> dict:
                # Your model inference code here
                return {"predictions": [...]}

            def predict(self, x, **kwargs):
                yield from self.predict_with_video_support(x, **kwargs)
    """

    @abstractmethod
    def _predict_single_image(self, filepath: str, **kwargs) -> dict:
        """
        Run inference on a single image.

        Args:
            filepath: Path to the image file
            **kwargs: Additional arguments passed from predict()

        Returns:
            Dictionary containing prediction results with a "predictions" key
        """
        pass

    def predict_with_video_support(self, x, **kwargs):
        """
        Main predict method with automatic video support.

        This method handles both images and videos. For videos, it extracts
        frames at the specified sample_fps and runs inference on each frame.

        If a single file fails (e.g. corrupt image), it logs the error and
        yields an error result instead of crashing the entire batch.

        Call this from your predict() method:
            def predict(self, x, **kwargs):
                yield from self.predict_with_video_support(x, **kwargs)

        Args:
            x: Request dictionary containing "instances" list
            **kwargs: Additional arguments

        Yields:
            Prediction dictionaries for each image/video frame
        """
        for instance in x["instances"]:
            filepath = instance["filepath"]
            sample_fps = instance.get("sample_fps", 1)

            try:
                if is_video_file(filepath):
                    yield from self._predict_video(filepath, sample_fps, **kwargs)
                else:
                    # For images, just pass through to single image prediction
                    yield self._predict_single_image(filepath, **kwargs)
            except Exception as e:
                logger.error(f"Skipping file due to error: {filepath!r} - {e}")
                yield {
                    "predictions": [
                        {
                            "filepath": str(filepath),
                            "prediction": "error",
                            "prediction_score": 0.0,
                            "error": str(e),
                            "classifications": {},
                            "detections": [],
                        }
                    ]
                }

    def _predict_video(self, video_path: str, sample_fps: int = 1, **kwargs):
        """
        Process a video file, yielding predictions for each sampled frame.

        Args:
            video_path: Path to the video file
            sample_fps: Target frames per second for sampling
            **kwargs: Additional arguments passed to _predict_single_image

        Yields:
            Prediction dictionaries with added video context:
            - frame_number: Index of the frame (0-based)
            - metadata: Dictionary with fps and duration
            - filepath: Original video path (not temp frame path)
        """
        # Get video metadata once
        metadata = get_video_metadata(video_path)
        logger.info(f"[Video] Processing {video_path} ({metadata['duration']:.1f}s at {sample_fps} fps)")

        frame_count = 0
        for frame_number, frame in extract_frames_at_fps(video_path, sample_fps):
            frame_count += 1
            # Save frame to temp file for model inference
            with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
                temp_path = tmp.name
                cv2.imwrite(temp_path, frame)

            try:
                # Run inference on the frame
                result = self._predict_single_image(temp_path, **kwargs)
                predictions = result.get("predictions", [])

                # Add video context to each prediction
                for pred in predictions:
                    pred["filepath"] = video_path  # Original video path
                    pred["frame_number"] = frame_number
                    pred["metadata"] = metadata

                yield {"predictions": predictions}

            finally:
                # Clean up temp file
                if os.path.exists(temp_path):
                    os.unlink(temp_path)

        logger.info(f"[Video] Completed {frame_count} frames from {video_path}")
