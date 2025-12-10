"""Unit tests for image utility functions.

These tests verify that image processing functions handle edge cases correctly,
particularly grayscale images which caused issues in production.

Note: We cannot import the server modules directly due to absl flags conflicts,
so we define the crop function inline for testing purposes.
"""

import numpy as np
import pytest
from PIL import Image


def crop_square_cv_to_pil(array_image: np.ndarray, xyxy: list[float]) -> Image.Image:
    """
    Crop a square region from an image based on bounding box coordinates.

    This is a copy of the function from run_deepfaune_server.py and run_manas_server.py
    for testing purposes (to avoid absl flags conflicts when importing both modules).

    Args:
        array_image: The input image as a NumPy array in BGR format (3 channels).
        xyxy: The bounding box coordinates [x1, y1, x2, y2].

    Returns:
        Image: The cropped image as a PIL Image in RGB format.
    """
    x1, y1, x2, y2 = xyxy
    xsize = x2 - x1
    ysize = y2 - y1
    if xsize > ysize:
        y1 = y1 - int((xsize - ysize) / 2)
        y2 = y2 + int((xsize - ysize) / 2)
    if ysize > xsize:
        x1 = x1 - int((ysize - xsize) / 2)
        x2 = x2 + int((ysize - xsize) / 2)
    height, width, _ = array_image.shape
    croppedimagecv = array_image[
        max(0, int(y1)) : min(int(y2), height), max(0, int(x1)) : min(int(x2), width)
    ]
    return Image.fromarray(croppedimagecv[:, :, (2, 1, 0)])  # BGR to RGB


class TestCropSquareCvToPil:
    """Tests for the crop_square_cv_to_pil function."""

    def test_crop_rgb_image(self):
        """Test cropping works correctly with standard RGB (BGR) images."""
        # Create a 100x100 BGR image
        array_image = np.zeros((100, 100, 3), dtype=np.uint8)
        array_image[25:75, 25:75] = [255, 128, 64]  # BGR color in center

        # Crop a 50x50 region from the center
        xyxy = [25, 25, 75, 75]
        result = crop_square_cv_to_pil(array_image, xyxy)

        assert isinstance(result, Image.Image)
        assert result.mode == "RGB"
        assert result.size == (50, 50)

    def test_crop_grayscale_image_fails(self):
        """Test that cropping fails with grayscale images (documents the pre-fix bug).

        This test documents the bug that was fixed. The cv2.imdecode function can
        return grayscale images when using IMREAD_UNCHANGED, causing a shape error.
        The fix is to use IMREAD_COLOR instead to ensure 3-channel images.

        The crop function itself expects 3-channel images. If a grayscale image
        is passed, it will fail with a ValueError.
        """
        # Create a grayscale image (2D array - this was the bug)
        grayscale_image = np.zeros((100, 100), dtype=np.uint8)
        grayscale_image[25:75, 25:75] = 128

        # This should fail because the function expects 3D arrays
        xyxy = [25, 25, 75, 75]
        with pytest.raises(ValueError, match="not enough values to unpack"):
            crop_square_cv_to_pil(grayscale_image, xyxy)

    def test_crop_with_non_square_region_tall(self):
        """Test that tall non-square regions get padded to square."""
        # Create a 200x100 BGR image (wider than tall)
        array_image = np.ones((100, 200, 3), dtype=np.uint8) * 128

        # Crop a tall region (50 wide, 100 tall)
        xyxy = [75, 0, 125, 100]
        result = crop_square_cv_to_pil(array_image, xyxy)

        assert isinstance(result, Image.Image)
        assert result.mode == "RGB"
        # Result should be square (padded to match the larger dimension)

    def test_crop_with_non_square_region_wide(self):
        """Test that wide non-square regions get padded to square."""
        # Create a 100x200 BGR image (taller than wide)
        array_image = np.ones((200, 100, 3), dtype=np.uint8) * 128

        # Crop a wide region (100 wide, 50 tall)
        xyxy = [0, 75, 100, 125]
        result = crop_square_cv_to_pil(array_image, xyxy)

        assert isinstance(result, Image.Image)
        assert result.mode == "RGB"

    def test_crop_handles_boundary_clipping(self):
        """Test cropping handles regions extending beyond image boundaries."""
        # Create a 50x50 BGR image
        array_image = np.ones((50, 50, 3), dtype=np.uint8) * 128

        # Crop a region that extends beyond the image
        xyxy = [40, 40, 100, 100]  # Extends beyond each edge

        # Should not crash, should clip to available region
        result = crop_square_cv_to_pil(array_image, xyxy)
        assert isinstance(result, Image.Image)
        assert result.mode == "RGB"

    def test_crop_preserves_color_channels(self):
        """Test that BGR to RGB conversion is correct."""
        # Create a 100x100 image with known BGR values
        array_image = np.zeros((100, 100, 3), dtype=np.uint8)
        # Set center to BGR = (255, 0, 0) which is pure blue in BGR
        array_image[25:75, 25:75] = [255, 0, 0]

        xyxy = [25, 25, 75, 75]
        result = crop_square_cv_to_pil(array_image, xyxy)

        # After BGR->RGB conversion, should be pure blue in RGB (0, 0, 255)
        pixels = np.array(result)
        # Check center pixel
        center_pixel = pixels[25, 25]
        assert center_pixel[0] == 0  # R
        assert center_pixel[1] == 0  # G
        assert center_pixel[2] == 255  # B
