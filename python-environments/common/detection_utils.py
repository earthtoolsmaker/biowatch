"""Shared utility functions for detection and classification pipelines.

These pure functions are used by multiple server modules (DeepFaune, Manas,
SpeciesNet) and are free of heavy dependencies like absl, litserve, or torch,
making them safe to import in tests without side effects.
"""

import numpy as np
from PIL import Image


def crop_square_cv_to_pil(array_image: np.ndarray, xyxy: list[float]) -> Image.Image:
    """
    Crop a square region from an image based on bounding box coordinates
    and convert it to a PIL Image.

    Args:
        array_image: The input image as a NumPy array in BGR format.
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
    croppedimagecv = array_image[max(0, int(y1)) : min(int(y2), height), max(0, int(x1)) : min(int(x2), width)]
    return Image.fromarray(croppedimagecv[:, :, (2, 1, 0)])  # BGR to RGB


def to_detection_record(
    conf: float,
    class_instance: int,
    xywhn: list[float],
    xyxy: list[float],
    class_label_mapping: dict[int, str],
) -> dict:
    """
    Create a detection record for an object detected in an image.

    Args:
        conf: The confidence score of the detection.
        class_instance: The class index of the detected object.
        xywhn: Normalized bounding box coordinates (center x, center y, width, height).
        xyxy: Bounding box coordinates (x1, y1, x2, y2).
        class_label_mapping: A mapping from class indices to class labels.

    Returns:
        dict: A dictionary containing the detection details.
    """
    return {
        "class": class_instance,
        "label": class_label_mapping[class_instance],
        "conf": conf,
        "xyxy": xyxy,
        "xywhn": xywhn,
    }


def select_best_animal_detection(detection_records: list[dict]) -> dict | None:
    """
    Select the best animal detection from the provided records based on confidence score.

    Args:
        detection_records: A list of detection records.

    Returns:
        dict | None: The detection record with the highest confidence score for "animal",
        or None if no such record exists.
    """
    animal_records = [r for r in detection_records if r["label"] == "animal"]
    sorted_animal_records = sorted(animal_records, key=lambda r: r["conf"], reverse=True)
    if not sorted_animal_records:
        return None
    else:
        return sorted_animal_records[0]


def to_classifications_record(
    scores: list[float],
    class_label_mapping: dict[int, str],
    k: int = 5,
) -> dict:
    """
    Create a record of the top-k classifications based on scores.

    Args:
        scores: A list of scores corresponding to each class.
        class_label_mapping: A mapping from class indices to class labels.
        k: The number of top classifications to return. Defaults to 5.

    Returns:
        dict: A dictionary containing the top-k labels and their scores.
    """
    top_k_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:k]
    top_k_labels = [class_label_mapping[i] for i in top_k_indices]
    top_k_scores = [scores[i] for i in top_k_indices]
    return {
        "labels": top_k_labels,
        "scores": top_k_scores,
    }


def propagate_extra_fields(
    extra_fields: list[str],
    instances_dict: dict,
    predictions_dict: dict,
) -> dict:
    """
    Propagate extra fields from request instances to response predictions.

    Args:
        extra_fields: List of field names to propagate.
        instances_dict: The original request containing instances.
        predictions_dict: The prediction results.

    Returns:
        Updated predictions dict with extra fields included.
    """
    predictions = predictions_dict["predictions"]
    new_predictions = {p["filepath"]: p for p in predictions}
    for instance in instances_dict["instances"]:
        for field in extra_fields:
            if field in instance:
                new_predictions[instance["filepath"]][field] = instance[field]
    return {"predictions": list(new_predictions.values())}
