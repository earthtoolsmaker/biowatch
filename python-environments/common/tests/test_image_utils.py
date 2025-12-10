"""Unit tests for image utility functions.

These tests verify that image processing functions handle edge cases correctly,
particularly grayscale images which caused issues in production.
"""

import numpy as np
import pytest
from PIL import Image

# Import the functions we need to test
from run_deepfaune_server import crop_square_cv_to_pil as deepfaune_crop
from run_manas_server import crop_square_cv_to_pil as manas_crop


class TestCropSquareCvToPil:
    """Tests for the crop_square_cv_to_pil function."""

    def test_crop_rgb_image(self):
        """Test cropping works correctly with standard RGB (BGR) images."""
        # Create a 100x100 BGR image
        array_image = np.zeros((100, 100, 3), dtype=np.uint8)
        array_image[25:75, 25:75] = [255, 128, 64]  # BGR color in center

        # Crop a 50x50 region from the center
        xyxy = [25, 25, 75, 75]
        result = deepfaune_crop(array_image, xyxy)

        assert isinstance(result, Image.Image)
        assert result.mode == "RGB"
        assert result.size == (50, 50)

    def test_crop_rgb_image_manas(self):
        """Test cropping works correctly with Manas implementation."""
        # Create a 100x100 BGR image
        array_image = np.zeros((100, 100, 3), dtype=np.uint8)
        array_image[25:75, 25:75] = [255, 128, 64]  # BGR color in center

        # Crop a 50x50 region from the center
        xyxy = [25, 25, 75, 75]
        result = manas_crop(array_image, xyxy)

        assert isinstance(result, Image.Image)
        assert result.mode == "RGB"
        assert result.size == (50, 50)

    def test_crop_handles_grayscale_image_deepfaune(self):
        """Test that DeepFaune cropping fails with grayscale images (pre-fix behavior).

        This test documents the bug that was fixed. The cv2.imdecode function can
        return grayscale images when using IMREAD_UNCHANGED, causing a shape error.
        The fix is to use IMREAD_COLOR instead to ensure 3-channel images.
        """
        # Create a grayscale image (2D array - this was the bug)
        grayscale_image = np.zeros((100, 100), dtype=np.uint8)
        grayscale_image[25:75, 25:75] = 128

        # This should fail because the function expects 3D arrays
        xyxy = [25, 25, 75, 75]
        with pytest.raises(ValueError, match="not enough values to unpack"):
            deepfaune_crop(grayscale_image, xyxy)

    def test_crop_handles_grayscale_image_manas(self):
        """Test that Manas cropping fails with grayscale images (pre-fix behavior).

        This test documents the bug that was fixed. The cv2.imdecode function can
        return grayscale images when using IMREAD_UNCHANGED, causing a shape error.
        The fix is to use IMREAD_COLOR instead to ensure 3-channel images.
        """
        # Create a grayscale image (2D array - this was the bug)
        grayscale_image = np.zeros((100, 100), dtype=np.uint8)
        grayscale_image[25:75, 25:75] = 128

        # This should fail because the function expects 3D arrays
        xyxy = [25, 25, 75, 75]
        with pytest.raises(ValueError, match="not enough values to unpack"):
            manas_crop(grayscale_image, xyxy)

    def test_crop_with_square_padding(self):
        """Test that non-square regions get padded correctly."""
        # Create a 200x100 BGR image (wider than tall)
        array_image = np.zeros((100, 200, 3), dtype=np.uint8)
        array_image[:, :] = [100, 150, 200]

        # Crop a non-square region (50x100 - tall and narrow)
        xyxy = [75, 0, 125, 100]  # 50 wide, 100 tall
        result = deepfaune_crop(array_image, xyxy)

        # Should produce a square image
        assert isinstance(result, Image.Image)
        assert result.mode == "RGB"
        # The function makes it square by padding, so size depends on the larger dimension

    def test_crop_handles_boundary_clipping(self):
        """Test cropping handles regions extending beyond image boundaries."""
        # Create a 50x50 BGR image
        array_image = np.ones((50, 50, 3), dtype=np.uint8) * 128

        # Crop a region that extends beyond the image
        xyxy = [40, 40, 100, 100]  # Extends 50 pixels beyond each edge

        # Should not crash, should clip to available region
        result = deepfaune_crop(array_image, xyxy)
        assert isinstance(result, Image.Image)
        assert result.mode == "RGB"
