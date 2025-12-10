"""
CLI script to run Manas as a LitServer.

Manas is a wildlife classifier developed by OSI-Panthera and Hex Data for
classifying wildlife species from camera trap images in Kirghizistan,
focusing on snow leopard (panthera uncia) and other regional fauna.

Start the server with the default parameter values:

```
run_manas_server.py \
  --filepath-classifier-weights ./path/to/weights/best_model_Fri_Sep__1_18_50_55_2023.pt \
  --filepath-classes ./path/to/classes/classes_Fri_Sep__1_18_50_55_2023.pickle \
  --filepath-detector-weights ./path/to/weights/MDV6-yolov10x.pt
```

Override the parameters:

```
run_manas_server.py \
  --port 8002 \
  --timeout 30 \
  --workers_per_device 1 \
  --backlog 2048 \
  --filepath-classifier-weights ./path/to/weights/best_model_Fri_Sep__1_18_50_55_2023.pt \
  --filepath-classes ./path/to/classes/classes_Fri_Sep__1_18_50_55_2023.pickle \
  --filepath-detector-weights ./path/to/weights/MDV6-yolov10x.pt
```

A Swagger API documentation is served at localhost:${port}/docs

health:

```
$ curl http://localhost:${port}/health
"ok"
```

info:

```
$ curl http://localhost:${port}/info

{
  "model": {
    "type": "manas",
    "version": "1.0"
  },
  "server": {
    "devices": [
      [
        "cuda:0"
      ]
    ],
    "workers_per_device": 1,
    "timeout": 30,
    "stream": true,
    "max_payload_size": null,
    "track_requests": false
  }
}
```

predict (streaming):

```
$ curl -X POST http://localhost:${port}/predict \
-H "Content-Type: application/json" \
-d '{
    "instances": [
        {
            "filepath": "/path/to/your/image"
        },
      ]
    }


{
  "output": {
    "predictions": [
      {
        "classifications": {
          "labels": [
            "panthera_uncia",
            "canidae",
            "caprinae",
            "mustelidae",
            "marmota"
          ],
          "scores": [
            0.9234,
            0.0456,
            0.0189,
            0.0078,
            0.0032
          ]
        },
        "detections": [
          {
            "class": 0,
            "conf": 0.9823879599571228,
            "label": "animal",
            "xywhn": [
              0.22085066139698029,
              0.5265612602233887,
              0.4415794909000397,
              0.8490889668464661
            ],
            "xyxy": [
              0.06091594696044922,
              76.5125503540039,
              441.640380859375,
              713.3292846679688
            ]
          }
        ],
        "filepath": "/path/to/your/image.jpg",
        "model_version": "1.0",
        "prediction": "panthera_uncia",
        "prediction_score": 0.9234
      }
    ]
  }
}
```
"""

import logging
import pickle
from dataclasses import dataclass
from pathlib import Path

import cv2
import litserve as ls
import numpy as np
import torch
from absl import app, flags
from fastapi import HTTPException
from PIL import Image
from torch import tensor
from torchvision.transforms import InterpolationMode, transforms
from ultralytics import YOLO

from video_utils import VideoCapableLitAPI, is_video_file

# Configure logging for diagnostic output
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# Constants
CROP_SIZE = 480  # EfficientNet V2 Large default input size
BACKBONE = "tf_efficientnetv2_l"  # timm model name for EfficientNet V2 Large
MODEL_VERSION = "1.0"
DETECTION_THRESHOLD = 0.33
CLASSIFICATION_THRESHOLD = 0.70


def load_class_mapping(filepath_classes: Path) -> dict[int, str]:
    """
    Load class label mapping from pickle file.

    The pickle file can contain either a list of class names (where index becomes
    the class ID) or a dictionary mapping class IDs to names.

    Args:
        filepath_classes: Path to the pickle file containing class names.

    Returns:
        dict: Mapping from class index (int) to class label (str).

    Raises:
        ValueError: If the pickle file contains an unexpected format.
    """
    with open(filepath_classes, "rb") as f:
        classes = pickle.load(f)

    if isinstance(classes, list):
        return dict(enumerate(classes))
    elif isinstance(classes, dict):
        return classes
    else:
        raise ValueError(f"Unexpected classes format: {type(classes)}")


class ManasClassifier:
    """
    Classifier for Manas model.

    The Manas model is saved as a TorchScript model, so we load it directly
    using torch.jit.load() rather than creating a model architecture and
    loading state_dict.

    Attributes:
        class_label_mapping (dict): Mapping from class indices to class labels.
        num_classes (int): Number of output classes.
        model: The loaded TorchScript model.
        transforms (transforms.Compose): Image preprocessing transformations.

    Methods:
        preprocess_image(cropped_image):
            Preprocess an image for classification.
        predict(batch, with_softmax):
            Run prediction on a batch of images.
    """

    def __init__(
        self,
        filepath_weights: Path,
        filepath_classes: Path,
        crop_size: int = CROP_SIZE,
    ):
        """
        Initialize the Manas classifier.

        Args:
            filepath_weights: Path to the TorchScript model file (.pt).
            filepath_classes: Path to the pickle file containing class names.
            crop_size: Size to resize input images to. Defaults to 480.
        """
        self.class_label_mapping = load_class_mapping(filepath_classes)
        self.num_classes = len(self.class_label_mapping)
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        # Load the TorchScript model directly
        self.model = self._load_model(filepath_weights)

        # Setup transforms (ImageNet normalization)
        self.transforms = transforms.Compose(
            [
                transforms.Resize(
                    size=(crop_size, crop_size),
                    interpolation=InterpolationMode.BICUBIC,
                ),
                transforms.ToTensor(),
                transforms.Normalize(
                    mean=tensor([0.485, 0.456, 0.406]),
                    std=tensor([0.229, 0.224, 0.225]),
                ),
            ]
        )

        logging.info(
            f"Initialized Manas classifier with {self.num_classes} classes: {list(self.class_label_mapping.values())}"
        )

    def _load_model(self, filepath_weights: Path):
        """
        Load the TorchScript model from file.

        Args:
            filepath_weights: Path to the TorchScript model file.

        Returns:
            The loaded TorchScript model.

        Raises:
            Exception: If the model cannot be loaded.
        """
        try:
            # Load TorchScript model directly
            model = torch.jit.load(filepath_weights, map_location=self.device)
            model.eval()
            logging.info(f"Loaded Manas TorchScript model from {filepath_weights} on device {self.device}")
            return model
        except Exception as e:
            logging.error(f"Failed to load model from {filepath_weights}: {e}")
            raise

    def preprocess_image(self, cropped_image: Image.Image) -> torch.Tensor:
        """
        Preprocess an image for classification.

        Args:
            cropped_image: PIL Image to preprocess.

        Returns:
            torch.Tensor: Preprocessed image tensor with batch dimension.
        """
        preprocessed = self.transforms(cropped_image)
        return preprocessed.unsqueeze(dim=0)

    def predict(self, batch: torch.Tensor, with_softmax: bool = True) -> np.ndarray:
        """
        Run prediction on a batch of images.

        Args:
            batch: Batch of preprocessed image tensors.
            with_softmax: Whether to apply softmax to outputs. Defaults to True.

        Returns:
            numpy.ndarray: Prediction scores for each class.
        """
        with torch.no_grad():
            x = batch.to(self.device)
            output = self.model(x)
            if with_softmax:
                output = output.softmax(dim=1)
            return output.cpu().numpy()


@dataclass
class ManasModel:
    """
    Container for the Manas detector and classifier models.

    Attributes:
        detector (YOLO): The YOLO object detection model.
        classifier (ManasClassifier): The species classification model.
    """

    detector: YOLO
    classifier: ManasClassifier


def load_model(
    filepath_detector_weights: Path,
    filepath_classifier_weights: Path,
    filepath_classes: Path,
    classifier_crop_size: int = CROP_SIZE,
) -> ManasModel:
    """
    Load the Manas model (detector + classifier).

    Args:
        filepath_detector_weights: Path to YOLO detector weights.
        filepath_classifier_weights: Path to classifier weights.
        filepath_classes: Path to classes pickle file.
        classifier_crop_size: Input size for classifier. Defaults to 480.

    Returns:
        ManasModel: Container with loaded detector and classifier.
    """
    classifier = ManasClassifier(
        filepath_weights=filepath_classifier_weights,
        filepath_classes=filepath_classes,
        crop_size=classifier_crop_size,
    )
    detector = YOLO(filepath_detector_weights)
    return ManasModel(detector=detector, classifier=classifier)


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


def crop_square_cv_to_pil(array_image: np.ndarray, xyxy: list[float]) -> Image.Image:
    """
    Crop a square region from an image based on bounding box coordinates.

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


def predict(
    model: ManasModel,
    filepath: Path,
    crop_size: int = CROP_SIZE,
    model_version: str = MODEL_VERSION,
    detection_threshold: float = DETECTION_THRESHOLD,
) -> dict:
    """
    Predict species for a given image using the Manas model.

    The prediction pipeline:
    1. Run YOLO detector to find animals
    2. Select best animal detection
    3. Crop and classify the detected region
    4. Return predictions with classifications and detections

    The "vide" class represents empty images (MegaDetector false negatives).

    Args:
        model: The ManasModel containing detector and classifier.
        filepath: Path to the image file.
        crop_size: Size for cropping. Defaults to CROP_SIZE.
        model_version: Model version string. Defaults to MODEL_VERSION.
        detection_threshold: Minimum confidence for detections. Defaults to 0.33.

    Returns:
        dict: Prediction results including classifications, detections, and top prediction.
    """
    class_label_mapping = model.classifier.class_label_mapping

    # Run detector
    ultralytics_results = model.detector(filepath, verbose=False, conf=detection_threshold)
    detections = ultralytics_results[0]
    bboxes = detections.boxes
    class_names = detections.names

    # Build detection records
    detection_records = [
        to_detection_record(
            conf=conf,
            class_instance=class_instance,
            xywhn=xywhn,
            xyxy=xyxy,
            class_label_mapping=class_names,
        )
        for conf, class_instance, xywhn, xyxy in zip(
            bboxes.conf.cpu().tolist(),
            bboxes.cls.cpu().numpy().astype(int).tolist(),
            bboxes.xywhn.cpu().numpy().tolist(),
            bboxes.xyxy.cpu().numpy().tolist(),
            strict=True,
        )
    ]

    selected_detection_record = select_best_animal_detection(detection_records)

    if not selected_detection_record:
        # No animal detected - return "vide" if available, else "blank"
        vide_prediction = "vide" if "vide" in class_label_mapping.values() else "blank"
        if not detection_records:
            return {
                "predictions": [
                    {
                        "filepath": str(filepath),
                        "classifications": {},
                        "detections": detection_records,
                        "prediction": vide_prediction,
                        "model_version": model_version,
                    }
                ],
            }
        else:
            return {
                "predictions": [
                    {
                        "filepath": str(filepath),
                        "classifications": {},
                        "detections": detection_records,
                        "prediction": detection_records[0]["label"],
                        "prediction_score": detection_records[0]["conf"],
                        "model_version": model_version,
                    }
                ],
            }

    # Crop and classify
    xyxy = selected_detection_record["xyxy"]
    # Use IMREAD_COLOR to ensure we always get a 3-channel BGR image
    # (IMREAD_UNCHANGED can return grayscale for some images, causing shape errors)
    imagecv = cv2.imdecode(np.fromfile(filepath, dtype=np.uint8), cv2.IMREAD_COLOR)
    croppedimage = crop_square_cv_to_pil(imagecv, xyxy)
    cropped_tensor = model.classifier.preprocess_image(croppedimage)
    scores = model.classifier.predict(cropped_tensor)

    classifications_record = to_classifications_record(
        scores[0].tolist(),
        class_label_mapping=class_label_mapping,
    )

    return {
        "predictions": [
            {
                "filepath": str(filepath),
                "classifications": classifications_record,
                "detections": detection_records,
                "prediction": classifications_record["labels"][0],
                "prediction_score": classifications_record["scores"][0],
                "model_version": model_version,
            }
        ]
    }


# CLI Flags
_PORT = flags.DEFINE_integer(
    "port",
    8002,
    "Port to run the server on.",
)
_API_PATH = flags.DEFINE_string(
    "api_path",
    "/predict",
    "URL path for the server endpoint.",
)
_WORKERS_PER_DEVICE = flags.DEFINE_integer(
    "workers_per_device",
    1,
    "Number of server replicas per device.",
)
_TIMEOUT = flags.DEFINE_integer(
    "timeout",
    30,
    "Timeout (in seconds) for requests.",
)
_BACKLOG = flags.DEFINE_integer(
    "backlog",
    2048,
    "Maximum number of connections to hold in backlog.",
)
_FILEPATH_DETECTOR_WEIGHTS = flags.DEFINE_string(
    name="filepath-detector-weights",
    default=None,
    help="Filepath for the weights of the detector (YOLO MDV6)",
    required=True,
)
_FILEPATH_CLASSIFIER_WEIGHTS = flags.DEFINE_string(
    name="filepath-classifier-weights",
    default=None,
    help="Filepath for the weights of the classifier (EfficientNet V2)",
    required=True,
)
_FILEPATH_CLASSES = flags.DEFINE_string(
    name="filepath-classes",
    default=None,
    help="Filepath for the pickle file containing class names",
    required=True,
)
_EXTRA_FIELDS = flags.DEFINE_list(
    "extra_fields",
    None,
    "Comma-separated list of extra fields to propagate from request to response.",
)


class ManasLitAPI(ls.LitAPI, VideoCapableLitAPI):
    """
    LitServe API implementation for the Manas model with video support.

    This class implements the server side of Manas by implementing the LitAPI
    interface required by the `litserve` library. It handles request parsing,
    model loading, inference, and response formatting.

    Video support is provided via the VideoCapableLitAPI mixin, which automatically
    detects video files and processes them frame by frame at the specified sample_fps.
    """

    def __init__(
        self,
        filepath_detector_weights: Path,
        filepath_classifier_weights: Path,
        filepath_classes: Path,
        extra_fields: list[str] | None = None,
        *args,
        **kwargs,
    ) -> None:
        """
        Initialize the Manas LitAPI.

        Args:
            filepath_detector_weights: Path to YOLO detector weights.
            filepath_classifier_weights: Path to classifier weights.
            filepath_classes: Path to classes pickle file.
            extra_fields: Optional list of fields to propagate from request to response.
        """
        super().__init__(*args, **kwargs)
        self.filepath_detector_weights = filepath_detector_weights
        self.filepath_classifier_weights = filepath_classifier_weights
        self.filepath_classes = filepath_classes
        self.extra_fields = extra_fields or []

    def setup(self, device):
        """
        Called once at startup to load the model.

        Args:
            device: The device to load the model on (unused, auto-detected).
        """
        del device  # Unused
        self.model = load_model(
            filepath_detector_weights=self.filepath_detector_weights,
            filepath_classifier_weights=self.filepath_classifier_weights,
            filepath_classes=self.filepath_classes,
        )

    def decode_request(self, request, **kwargs):
        """
        Validate incoming HTTP requests.

        Args:
            request: The incoming request dictionary.

        Returns:
            The validated request.

        Raises:
            HTTPException: If a filepath doesn't exist.
        """
        for instance in request["instances"]:
            filepath = instance["filepath"]
            # Skip file_exists check for video files (they're processed frame by frame)
            if not is_video_file(filepath) and not Path(filepath).exists():
                raise HTTPException(400, f"Cannot access filepath: `{filepath}`")
        return request

    def _propagate_extra_fields(
        self,
        instances_dict: dict,
        predictions_dict: dict,
    ) -> dict:
        """
        Propagate extra fields from request to response.

        Args:
            instances_dict: The original request instances.
            predictions_dict: The prediction results.

        Returns:
            Updated predictions with extra fields included.
        """
        predictions = predictions_dict["predictions"]
        new_predictions = {p["filepath"]: p for p in predictions}
        for instance in instances_dict["instances"]:
            for field in self.extra_fields:
                if field in instance:
                    new_predictions[instance["filepath"]][field] = instance[field]
        return {"predictions": list(new_predictions.values())}

    def _predict_single_image(self, filepath: str, **kwargs) -> dict:
        """
        Run Manas inference on a single image.

        This method is called by VideoCapableLitAPI for both images and video frames.

        Args:
            filepath: Path to the image file (or temp frame file for videos)
            **kwargs: Additional arguments (unused)

        Returns:
            Dictionary with "predictions" key containing model results
        """
        single_instances_dict = {"instances": [{"filepath": filepath}]}
        single_predictions_dict = predict(
            model=self.model,
            filepath=filepath,
        )
        assert single_predictions_dict is not None
        return self._propagate_extra_fields(single_instances_dict, single_predictions_dict)

    def predict(self, x, **kwargs):
        """
        Process prediction requests with automatic video support.

        For images: Runs inference directly.
        For videos: Extracts frames at sample_fps and runs inference on each.
        """
        instances = x.get("instances", [])
        logger.info(f"[Manas] Processing {len(instances)} instances")
        try:
            yield from self.predict_with_video_support(x, **kwargs)
        except Exception as e:
            logger.error(f"[Manas] Prediction failed: {e}", exc_info=True)
            raise

    def encode_response(self, output, **kwargs):
        """
        Format predictions for HTTP response.

        Args:
            output: The prediction output generator.

        Yields:
            Formatted response dictionaries.
        """
        for out in output:
            yield {"output": out}


def main(argv: list[str]) -> None:
    """
    Main entry point for the Manas server.

    Args:
        argv: Command line arguments (unused, handled by absl).
    """
    del argv  # Unused

    api = ManasLitAPI(
        filepath_classifier_weights=Path(_FILEPATH_CLASSIFIER_WEIGHTS.value),
        filepath_detector_weights=Path(_FILEPATH_DETECTOR_WEIGHTS.value),
        filepath_classes=Path(_FILEPATH_CLASSES.value),
        extra_fields=_EXTRA_FIELDS.value,
        api_path=_API_PATH.value,
        stream=True,
    )
    model_metadata = {"version": MODEL_VERSION, "type": "manas"}
    server = ls.LitServer(
        api,
        accelerator="auto",
        devices="auto",
        workers_per_device=_WORKERS_PER_DEVICE.value,
        model_metadata=model_metadata,
        timeout=_TIMEOUT.value,
        enable_shutdown_api=True,
    )
    server.run(
        port=_PORT.value,
        generate_client_file=False,
        backlog=_BACKLOG.value,
    )


if __name__ == "__main__":
    app.run(main)
