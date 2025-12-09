"""
CLI script to run DeepFaune as a LitServer.


Start the server with the default parameter values:

```
run_deepfaune_server.py
```

Override the parameters:

```
run_deepfaune_server.py \
  --port 8000 \
  --timeout 30 \
  --workers_per_device 1 \
  --backlog 2048 \
  --filepath-classifier-weights ./path/to/weights/deepfaune-vit_large_patch14_dinov2.lvd142m.v3.pt
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
    "type": "deepfaune",
    "version": "0.13"
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
            "chamois",
            "marmot",
            "ibex",
            "badger",
            "mustelid"
          ],
          "scores": [
            0.9999195337295532,
            0.00003925038981833495,
            0.000007861674930609297,
            0.000004211383838992333,
            0.0000040040545172814745
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
        "filepath": "/media/data/ssd_1/earthtoolsmaker/projects/biowatch/python-environments/common/data/chamois1.JPG",
        "model_version": "1.3",
        "prediction": "chamois",
        "prediction_score": 0.9999195337295532
      }
    ]
  }
}
```
"""

import logging
import sys
from dataclasses import dataclass
from pathlib import Path

import cv2
import litserve as ls
import numpy as np
import timm
import torch
import torch.nn as nn
from absl import app, flags
from fastapi import HTTPException
from PIL import Image
from torch import tensor
from torchvision.transforms import InterpolationMode, transforms
from ultralytics import YOLO

from video_utils import VideoCapableLitAPI, is_video_file

CROP_SIZE = 182
BACKBONE = "vit_large_patch14_dinov2.lvd142m"
CLASS_LABEL_MAPPING = {
    0: "bison",
    1: "badger",
    2: "ibex",
    3: "beaver",
    4: "red deer",
    5: "chamois",
    6: "cat",
    7: "goat",
    8: "roe deer",
    9: "dog",
    10: "fallow deer",
    11: "squirrel",
    12: "moose",
    13: "equid",
    14: "genet",
    15: "wolverine",
    16: "hedgehog",
    17: "lagomorph",
    18: "wolf",
    19: "otter",
    20: "lynx",
    21: "marmot",
    22: "micromammal",
    23: "mouflon",
    24: "sheep",
    25: "mustelid",
    26: "bird",
    27: "bear",
    28: "nutria",
    29: "raccoon",
    30: "fox",
    31: "reindeer",
    32: "wild boar",
    33: "cow",
}


class Classifier:
    """
    Classifier for image classification tasks using a specified backbone model.

    Attributes:
        model (Model): The underlying model used for predictions.
        transforms (torchvision.transforms.Compose): The preprocessing transformations applied to input images.

    Methods:
        predict_on_batch(batchtensor, withsoftmax=True):
            Predict the classes for a batch of input tensors.

        preprocess_image(croppedimage):
            Preprocess an image by applying the necessary transformations and adding a batch dimension.
    """

    def __init__(
        self,
        filepath_weights: Path,
        backbone: str,
        crop_size: int,
        num_classes: int,
    ):
        self.model = Model(
            filepath_weights=filepath_weights,
            backbone=backbone,
            crop_size=crop_size,
            num_classes=num_classes,
        )
        self.model.load_weights(str(filepath_weights))
        self.transforms = transforms.Compose(
            [
                transforms.Resize(
                    size=(crop_size, crop_size),
                    interpolation=InterpolationMode.BICUBIC,
                    max_size=None,
                ),
                transforms.ToTensor(),
                transforms.Normalize(
                    mean=tensor([0.4850, 0.4560, 0.4060]),
                    std=tensor([0.2290, 0.2240, 0.2250]),
                ),
            ]
        )

    def predict_on_batch(self, batch: torch.Tensor, with_softmax: bool = True):
        """
        Predict the classes for a batch of input tensors.

        Args:
            batch (torch.Tensor): A batch of input tensors for prediction.
            with_softmax (bool): Whether to apply softmax to the output probabilities.

        Returns:
            numpy.ndarray: The predicted class probabilities or class indices depending on withsoftmax.
        """
        return self.model.predict(batch, with_softmax)

    def preprocess_image(self, cropped_image):
        """
        Preprocess an image by applying the necessary transformations and adding a batch dimension.

        Args:
            cropped_image (PIL.Image): The input image to be preprocessed.

        Returns:
            torch.Tensor: The preprocessed image tensor with an added batch dimension.
        """
        preprocessimage = self.transforms(cropped_image)
        return preprocessimage.unsqueeze(dim=0)


class Model(nn.Module):
    """
    Model class for the deep learning architecture.

    This class encapsulates the model definition using a specified backbone,
    loading of weights, and prediction functionality.

    Attributes:
        base_model (torch.nn.Module): The underlying model architecture.
        backbone (str): The name of the backbone model.
        nbclasses (int): The number of output classes for the model.
    """

    def __init__(self, filepath_weights: Path, backbone: str, crop_size: int, num_classes: int):
        """
        Initialize the Classifier with the specified model parameters.

        Args:
            filepath_weights (Path): Path to the model weights file.
            backbone (str): The backbone architecture to be used for the model.
            crop_size (int): The size to which input images will be cropped.
            num_classes (int): The number of output classes for the model.
        """
        super().__init__()
        self.base_model = timm.create_model(
            backbone,
            pretrained=False,
            num_classes=num_classes,
            dynamic_img_size=True,
        )
        logging.info(f"Using {backbone} with weights at {filepath_weights}, in resolution {crop_size}x{crop_size}")
        self.backbone = backbone
        self.nbclasses = num_classes

    def forward(self, input):
        """
        Forward pass through the model.

        Args:
            input (torch.Tensor): Input tensor for the model.

        Returns:
            torch.Tensor: Output tensor from the model.
        """
        x = self.base_model(input)
        return x

    def predict(self, data, withsoftmax=True):
        """
        Predict the output for the given input data.

        Args:
            data (torch.Tensor): Input data tensor for prediction.
            withsoftmax (bool): Flag to indicate whether to apply softmax to the output.

        Returns:
            numpy.ndarray: The predicted class probabilities or class indices depending on withsoftmax.
        """
        self.eval()
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.to(device)
        total_output = []
        with torch.no_grad():
            x = data.to(device)
            output = self.forward(x).softmax(dim=1) if withsoftmax else self.forward(x)
            total_output += output.tolist()

        return np.array(total_output)

    def load_weights(self, path):
        """
        Load model weights from the specified file path.

        Args:
            path (str): The path to the weights file. If the path does not end with '.pt',
                         it will be appended with '.pt'.

        Raises:
            Exception: If the model architecture does not match the number of classes in the
                        loaded weights or if the weights cannot be loaded.
        """
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        if path[-3:] != ".pt":
            path += ".pt"
        try:
            params = torch.load(path, map_location=device, weights_only=False)
            args = params["args"]
            if self.nbclasses != args["num_classes"]:
                raise Exception(
                    "You load a model ({}) that does not have the same number of class({})".format(
                        args["num_classes"], self.nbclasses
                    )
                )
            self.backbone = args["backbone"]
            self.nbclasses = args["num_classes"]
            self.load_state_dict(params["state_dict"])
        except Exception as e:
            print("Can't load checkpoint model because :\n\n " + str(e), file=sys.stderr)
            raise e


@dataclass
class DeepFauneModel:
    """
    A model that encapsulates both the object detector and classifier for wildlife detection tasks.

    Attributes:
        detector (YOLO): The object detection model.
        classifier (Classifier): The image classification model.
    """

    detector: YOLO
    classifier: Classifier


def load_model(
    filepath_detector_weights: Path,
    filepath_classifier_weights: Path,
    classifier_backbone: str,
    classifier_crop_size: int,
    classifier_num_classes: int,
) -> DeepFauneModel:
    """
    Load the object detection and image classification models.

    Args:
        filepath_detector_weights (Path): Path to the YOLO object detector weights.
        filepath_classifier_weights (Path): Path to the image classifier weights.
        classifier_backbone (str): The backbone architecture for the classifier.
        classifier_crop_size (int): The size to which input images will be cropped for classification.
        classifier_num_classes (int): The number of output classes for the classifier.

    Returns:
        DeepFauneModel: An instance containing both the detector and classifier models.
    """
    classifier = Classifier(
        filepath_weights=filepath_classifier_weights,
        backbone=classifier_backbone,
        crop_size=classifier_crop_size,
        num_classes=classifier_num_classes,
    )
    detector = YOLO(filepath_detector_weights)
    return DeepFauneModel(detector=detector, classifier=classifier)


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
        conf (float): The confidence score of the detection.
        class_instance (int): The class index of the detected object.
        xywhn (list[float]): Normalized bounding box coordinates (center x, center y, width, height).
        xyxy (list[float]): Bounding box coordinates (x1, y1, x2, y2).
        class_label_mapping (dict[int, str]): A mapping from class indices to class labels.

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
    Select the best animal detection from the provided records based on the confidence score.

    Args:
        detection_records (list[dict]): A list of detection records, each containing details
        about a detected object including its confidence score and label.

    Returns:
        dict | None: The detection record with the highest confidence score for the label "animal",
        or None if no such record exists.
    """
    animal_records = [r for r in detection_records if r["label"] == "animal"]
    sorted_animal_records = sorted(animal_records, key=lambda r: r["conf"], reverse=True)
    if not sorted_animal_records:
        return None
    else:
        return sorted_animal_records[0]


def crop_square_cv_to_pil(array_image: np.ndarray, xyxy: list[float]):
    """
    Crop a square region from a given image based on the provided bounding box coordinates
    and convert it to a PIL Image.

    Args:
        array_image (np.ndarray): The input image as a NumPy array in BGR format.
        xyxy (list[float]): The bounding box coordinates in the format [x1, y1, x2, y2].

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
    return Image.fromarray(croppedimagecv[:, :, (2, 1, 0)])  # converted to PIL BGR image


def to_classifications_record(
    scores: list[float],
    class_label_mapping: dict[int, str],
    k: int = 5,
) -> dict:
    """
    Create a record of the top-k classifications based on the provided scores.

    Args:
        scores (list[float]): A list of scores corresponding to each class.
        class_label_mapping (dict[int, str]): A mapping from class indices to class labels.
        k (int): The number of top classifications to return. Defaults to 5.

    Returns:
        dict: A dictionary containing the top-k labels and their corresponding scores.
    """
    top_k_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[:k]
    top_k_labels = [class_label_mapping[i] for i in top_k_indices]
    top_k_scores = [scores[i] for i in top_k_indices]
    return {
        "labels": top_k_labels,
        "scores": top_k_scores,
    }


def predict(
    model: DeepFauneModel,
    filepath: Path,
    crop_size: int = CROP_SIZE,
    model_version: str = "1.3",
    class_label_mapping: dict[int, str] = CLASS_LABEL_MAPPING,
) -> dict:
    """
    Predict the class and confidence score for a given image using the specified model.

    Args:
        model (DeepFauneModel): The model containing the object detection and classification components.
        filepath (Path): The path to the image file to be processed.
        crop_size (int): The size to which the cropped image will be resized. Default is CROP_SIZE.
        model_version (str): The version of the model being used. Default is "1.3".
        class_label_mapping (dict[int, str]): A mapping from class indices to class labels.

    Returns:
        dict: A dictionary containing the prediction results, including:
            - filepath: The path to the input image.
            - classifications: The top classifications and their scores.
            - detections: The detection records from the object detection model.
            - prediction: The predicted class label for the image.
            - prediction_score: The confidence score for the predicted class.
            - model_version: The version of the model used for prediction.
    """
    ultralytics_results = model.detector(filepath, verbose=False)
    detections = ultralytics_results[0]
    bboxes = detections.boxes
    class_names = detections.names
    xyxy = bboxes.xyxy.cpu().numpy().tolist()
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
        if not detection_records:
            return {
                "predictions": [
                    {
                        "filepath": str(filepath),
                        "classifications": {},
                        "detections": detection_records,
                        "prediction": "blank",
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

    else:
        xyxy = selected_detection_record["xyxy"]
        imagecv = cv2.imdecode(np.fromfile(filepath, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
        croppedimage = crop_square_cv_to_pil(imagecv, xyxy)
        cropped_tensor = torch.ones((1, 3, crop_size, crop_size))
        cropped_tensor[0, :, :, :] = model.classifier.preprocess_image(croppedimage)
        scores = model.classifier.model.predict(cropped_tensor)
        classifications_record = (
            {}
            if not xyxy
            else to_classifications_record(
                scores[0].tolist(),
                class_label_mapping=dict(class_label_mapping.items()),
            )
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


_PORT = flags.DEFINE_integer(
    "port",
    8000,
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
    help="filepath for the weights of the detector",
    required=True,
)
_FILEPATH_CLASSIFIER_WEIGHTS = flags.DEFINE_string(
    name="filepath-classifier-weights",
    default=None,
    help="filepath for the weights of the classifier",
    required=True,
)
_EXTRA_FIELDS = flags.DEFINE_list(
    "extra_fields",
    None,
    "Comma-separated list of extra fields to propagate from request to response.",
)


class DeepFauneLitAPI(ls.LitAPI, VideoCapableLitAPI):
    """DeepFaune API server with video support.

    Video support is provided via the VideoCapableLitAPI mixin, which automatically
    detects video files and processes them frame by frame at the specified sample_fps.
    """

    def __init__(
        self,
        filepath_detector_weights: Path,
        filepath_classifier_weights: Path,
        extra_fields: list[str] | None = None,
        *args,
        **kwargs,
    ) -> None:
        super().__init__(*args, **kwargs)
        self.filepath_detector_weights = filepath_detector_weights
        self.filepath_classifier_weights = filepath_classifier_weights
        self.extra_fields = extra_fields or []

    def setup(self, device):
        del device  # Unused.
        self.model = load_model(
            filepath_detector_weights=self.filepath_detector_weights,
            filepath_classifier_weights=self.filepath_classifier_weights,
            classifier_backbone=BACKBONE,
            classifier_crop_size=CROP_SIZE,
            classifier_num_classes=len(CLASS_LABEL_MAPPING),
        )

    def decode_request(self, request, **kwargs):
        for instance in request["instances"]:
            filepath = instance["filepath"]
            # Skip file exists check for video files (they're processed frame by frame)
            if not is_video_file(filepath) and not Path(filepath).exists():
                raise HTTPException(400, f"Cannot access filepath: `{filepath}`")
        return request

    def _propagate_extra_fields(
        self,
        instances_dict: dict,
        predictions_dict: dict,
    ) -> dict:
        predictions = predictions_dict["predictions"]
        new_predictions = {p["filepath"]: p for p in predictions}
        for instance in instances_dict["instances"]:
            for field in self.extra_fields:
                if field in instance:
                    new_predictions[instance["filepath"]][field] = instance[field]
        return {"predictions": list(new_predictions.values())}

    def _predict_single_image(self, filepath: str, **kwargs) -> dict:
        """Run DeepFaune inference on a single image.

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
        return self._propagate_extra_fields(
            single_instances_dict, single_predictions_dict
        )

    def predict(self, x, **kwargs):
        """Process prediction requests with automatic video support.

        For images: Runs inference directly.
        For videos: Extracts frames at sample_fps and runs inference on each.
        """
        yield from self.predict_with_video_support(x, **kwargs)

    def encode_response(self, output, **kwargs):
        for out in output:
            yield {"output": out}


def main(argv: list[str]) -> None:
    api = DeepFauneLitAPI(
        filepath_classifier_weights=Path(_FILEPATH_CLASSIFIER_WEIGHTS.value),
        filepath_detector_weights=Path(_FILEPATH_DETECTOR_WEIGHTS.value),
        extra_fields=_EXTRA_FIELDS.value,
        api_path=_API_PATH.value,
        stream=True,
    )
    model_metadata = {"version": "1.3", "type": "speciesnet"}
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
