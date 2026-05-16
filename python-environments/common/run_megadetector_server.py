"""
CLI script to run MegaDetector v6 as a LitServer.

MegaDetector v6 is a YOLO-based detector (animals / people / vehicles only — no
species classification). Used in Biowatch as a fast blank-filter before manual
species annotation.

Start the server:

```
run_megadetector_server.py \\
  --port 8000 \\
  --filepath-detector-weights ./path/to/MDV6-yolov10-e-1280.pt \\
  --detection-confidence-threshold 0.2
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
  "model": {"type": "megadetector", "version": "6.0"},
  "server": {...}
}
```

predict (streaming):

```
$ curl -X POST http://localhost:${port}/predict \\
  -H "Content-Type: application/json" \\
  -d '{"instances": [{"filepath": "/path/to/your/image"}]}'
```

Output per image:

```json
{
  "output": {
    "predictions": [{
      "filepath": "/path/to/image",
      "classifications": {},
      "detections": [
        {"label": "animal", "conf": 0.94, "xywhn": [...], "xyxy": [...]}
      ],
      "prediction": "animal",
      "prediction_score": 0.94,
      "model_version": "6.0"
    }]
  }
}
```

The top-level `prediction` field translates MD's `"person"` label to the
binomial `"homo sapiens"` (the only MD category that is genuinely a species),
so it integrates with Biowatch's species tooltips and IUCN lookups. Per-bbox
`detections[].label` stays raw.
"""

import logging
from pathlib import Path

import litserve as ls
from absl import app, flags
from fastapi import HTTPException
from ultralytics import YOLO

from detection_utils import propagate_extra_fields, to_detection_record
from utils import VideoCapableLitAPI, is_video_file, safe_imread

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

MODEL_VERSION = "6.0"

# Map MegaDetector detection labels to Biowatch-canonical scientific names
# for the top-level `prediction` field. Per-bbox `detections[].label` stays raw.
# `person` is genuinely a species — emit the binomial so it integrates with
# Biowatch's species tooltips and IUCN lookups. `animal` and `vehicle` are not
# species and pass through unchanged.
LABEL_TO_PREDICTION = {
    "person": "homo sapiens",
}

_PORT = flags.DEFINE_integer("port", 8000, "Port to run the server on.")
_API_PATH = flags.DEFINE_string("api_path", "/predict", "URL path for the server endpoint.")
_WORKERS_PER_DEVICE = flags.DEFINE_integer("workers_per_device", 1, "Number of server replicas per device.")
_TIMEOUT = flags.DEFINE_integer("timeout", 30, "Timeout (in seconds) for requests.")
_BACKLOG = flags.DEFINE_integer("backlog", 2048, "Maximum number of connections to hold in backlog.")
_FILEPATH_DETECTOR_WEIGHTS = flags.DEFINE_string(
    name="filepath-detector-weights",
    default=None,
    help="filepath for the weights of the MegaDetector detector",
    required=True,
)
_DETECTION_CONFIDENCE_THRESHOLD = flags.DEFINE_float(
    "detection-confidence-threshold",
    0.2,
    "Confidence threshold below which a detection is ignored when computing the top prediction. "
    "Detections themselves are always returned; this only controls the 'prediction'/'prediction_score' fields.",
)
_EXTRA_FIELDS = flags.DEFINE_list(
    "extra_fields",
    None,
    "Comma-separated list of extra fields to propagate from request to response.",
)


def predict_one(
    detector: YOLO,
    filepath: Path,
    confidence_threshold: float,
    model_version: str = MODEL_VERSION,
) -> dict:
    """Run MegaDetector on a single image and produce a Biowatch-compatible prediction dict.

    The 'prediction' field is the label of the highest-confidence detection
    whose conf >= confidence_threshold, translated via LABEL_TO_PREDICTION.
    When no detection passes the threshold, prediction is 'blank' and
    prediction_score is None.
    """
    imagecv = safe_imread(filepath)
    ultralytics_results = detector(imagecv, verbose=False)
    yolo_out = ultralytics_results[0]
    bboxes = yolo_out.boxes
    # class_names comes from the .pt file's embedded `names` attribute — never hard-code.
    class_names = yolo_out.names

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

    # MD detects across animal/person/vehicle — pick top-confidence across ALL classes.
    # (We don't reuse select_best_animal_detection, which filters for the animal class.)
    above = [d for d in detection_records if d["conf"] >= confidence_threshold]
    if not above:
        return {
            "predictions": [
                {
                    "filepath": str(filepath),
                    "classifications": {},
                    "detections": detection_records,
                    "prediction": "blank",
                    "prediction_score": None,
                    "model_version": model_version,
                }
            ],
        }

    top = max(above, key=lambda d: d["conf"])
    prediction_label = LABEL_TO_PREDICTION.get(top["label"], top["label"])
    return {
        "predictions": [
            {
                "filepath": str(filepath),
                "classifications": {},
                "detections": detection_records,
                "prediction": prediction_label,
                "prediction_score": top["conf"],
                "model_version": model_version,
            }
        ],
    }


class MegaDetectorLitAPI(ls.LitAPI, VideoCapableLitAPI):
    """MegaDetector API server with video support."""

    def __init__(
        self,
        filepath_detector_weights: Path,
        detection_confidence_threshold: float,
        extra_fields: list[str] | None = None,
        *args,
        **kwargs,
    ) -> None:
        super().__init__(*args, **kwargs)
        self.filepath_detector_weights = filepath_detector_weights
        self.detection_confidence_threshold = detection_confidence_threshold
        self.extra_fields = extra_fields or []

    def setup(self, device):
        del device  # Unused.
        self.detector = YOLO(self.filepath_detector_weights)

    def decode_request(self, request, **kwargs):
        for instance in request["instances"]:
            filepath = instance["filepath"]
            if not is_video_file(filepath) and not Path(filepath).exists():
                raise HTTPException(400, f"Cannot access filepath: `{filepath}`")
        return request

    def _predict_single_image(self, filepath: str, **kwargs) -> dict:
        single_instances_dict = {"instances": [{"filepath": filepath}]}
        single_predictions_dict = predict_one(
            detector=self.detector,
            filepath=Path(filepath),
            confidence_threshold=self.detection_confidence_threshold,
        )
        return propagate_extra_fields(self.extra_fields, single_instances_dict, single_predictions_dict)

    def predict(self, x, **kwargs):
        instances = x.get("instances", [])
        logger.info(f"[MegaDetector] Processing {len(instances)} instances")
        try:
            yield from self.predict_with_video_support(x, **kwargs)
        except Exception as e:
            logger.error(f"[MegaDetector] Prediction failed: {e}", exc_info=True)
            raise

    def encode_response(self, output, **kwargs):
        for out in output:
            yield {"output": out}


def main(argv: list[str]) -> None:
    del argv  # Unused.
    print("[STARTUP] Starting MegaDetector LitServer...")
    api = MegaDetectorLitAPI(
        filepath_detector_weights=Path(_FILEPATH_DETECTOR_WEIGHTS.value),
        detection_confidence_threshold=_DETECTION_CONFIDENCE_THRESHOLD.value,
        extra_fields=_EXTRA_FIELDS.value,
        api_path=_API_PATH.value,
        stream=True,
    )
    model_metadata = {"version": MODEL_VERSION, "type": "megadetector"}
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
