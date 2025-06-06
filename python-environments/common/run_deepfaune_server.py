# Copyright CNRS 2024

# simon.chamaille@cefe.cnrs.fr; vincent.miele@univ-lyon1.fr

# This software is a computer program whose purpose is to identify
# animal species in camera trap images.

# This software is governed by the CeCILL  license under French law and
# abiding by the rules of distribution of free software.  You can  use,
# modify and/ or redistribute the software under the terms of the CeCILL
# license as circulated by CEA, CNRS and INRIA at the following URL
# "http://www.cecill.info".

# As a counterpart to the access to the source code and  rights to copy,
# modify and redistribute granted by the license, users are provided only
# with a limited warranty  and the software's author,  the holder of the
# economic rights,  and the successive licensors  have only  limited
# liability.

# In this respect, the user's attention is drawn to the risks associated
# with loading,  using,  modifying and/or developing or reproducing the
# software by the user in light of its specific status of free software,
# that may mean  that it is complicated to manipulate,  and  that  also
# therefore means  that it is reserved for developers  and  experienced
# professionals having in-depth computer knowledge. Users are therefore
# encouraged to load and test the software's suitability as regards their
# requirements in conditions enabling the security of their systems and/or
# data to be ensured and,  more generally, to use and operate it in the
# same conditions as regards security.

# The fact that you are presently reading this means that you have had
# knowledge of the CeCILL license and that you accept its terms.

import logging
import sys
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
import timm
import torch
import torch.nn as nn
from PIL import Image
from torch import tensor
from torchvision.transforms import InterpolationMode, transforms
from ultralytics import YOLO

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
        self.model.loadWeights(str(filepath_weights))
        self.transforms = transforms.Compose(
            [
                transforms.Resize(
                    size=(crop_size, crop_size),
                    interpolation=InterpolationMode.BICUBIC,
                    max_size=None,
                    antialias=None,
                ),
                transforms.ToTensor(),
                transforms.Normalize(
                    mean=tensor([0.4850, 0.4560, 0.4060]),
                    std=tensor([0.2290, 0.2240, 0.2250]),
                ),
            ]
        )

    def predictOnBatch(self, batchtensor, withsoftmax=True):
        return self.model.predict(batchtensor, withsoftmax)

    # croppedimage loaded by PIL
    def preprocessImage(self, croppedimage):
        preprocessimage = self.transforms(croppedimage)
        return preprocessimage.unsqueeze(dim=0)


class Model(nn.Module):
    def __init__(
        self, filepath_weights: Path, backbone: str, crop_size: int, num_classes: int
    ):
        """
        Constructor of model classifier
        """
        super().__init__()
        self.base_model = timm.create_model(
            backbone,
            pretrained=False,
            num_classes=num_classes,
            dynamic_img_size=True,
        )
        logging.info(
            f"Using {backbone} with weights at {filepath_weights}, in resolution {crop_size}x{crop_size}"
        )
        self.backbone = backbone
        self.nbclasses = num_classes

    def forward(self, input):
        x = self.base_model(input)
        return x

    def predict(self, data, withsoftmax=True):
        """
        Predict on test DataLoader
        :param test_loader: test dataloader: torch.utils.data.DataLoader
        :return: numpy array of predictions without soft max
        """
        self.eval()
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.to(device)
        total_output = []
        with torch.no_grad():
            x = data.to(device)
            if withsoftmax:
                output = self.forward(x).softmax(dim=1)
            else:
                output = self.forward(x)
            total_output += output.tolist()

        return np.array(total_output)

    def loadWeights(self, path):
        """
        :param path: path of .pt save of model
        """
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

        if path[-3:] != ".pt":
            path += ".pt"
        try:
            params = torch.load(path, map_location=device, weights_only=False)
            args = params["args"]
            if self.nbclasses != args["num_classes"]:
                raise Exception(
                    "You load a model ({}) that does not have the same number of class"
                    "({})".format(args["num_classes"], self.nbclasses)
                )
            self.backbone = args["backbone"]
            self.nbclasses = args["num_classes"]
            self.load_state_dict(params["state_dict"])
        except Exception as e:
            print(
                "Can't load checkpoint model because :\n\n " + str(e), file=sys.stderr
            )
            raise e


@dataclass
class DeepFauneModel:
    detector: YOLO
    classifier: Classifier


def load_model(
    filepath_detector_weights: Path,
    filepath_classifier_weights: Path,
    classifier_backbone: str,
    classifier_crop_size: int,
    classifier_num_classes: int,
) -> DeepFauneModel:
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
    return {
        "class": class_instance,
        "label": class_label_mapping[class_instance],
        "conf": conf,
        "xyxy": xyxy,
        "xywhn": xywhn,
    }


def select_best_animal_detection(detection_records: list[dict]) -> dict | None:
    animal_records = [r for r in detection_records if r["label"] == "animal"]
    sorted_animal_records = sorted(
        animal_records, key=lambda r: r["conf"], reverse=True
    )
    if not sorted_animal_records:
        return None
    else:
        return sorted_animal_records[0]


def crop_square_cv_to_pil(imagecv, xyxy):
    x1, y1, x2, y2 = xyxy
    xsize = x2 - x1
    ysize = y2 - y1
    if xsize > ysize:
        y1 = y1 - int((xsize - ysize) / 2)
        y2 = y2 + int((xsize - ysize) / 2)
    if ysize > xsize:
        x1 = x1 - int((ysize - xsize) / 2)
        x2 = x2 + int((ysize - xsize) / 2)
    height, width, _ = imagecv.shape
    croppedimagecv = imagecv[
        max(0, int(y1)) : min(int(y2), height), max(0, int(x1)) : min(int(x2), width)
    ]
    croppedimage = Image.fromarray(
        croppedimagecv[:, :, (2, 1, 0)]
    )  # converted to PIL BGR image
    return croppedimage


def to_classifications_record(
    scores: list[float],
    class_label_mapping: dict[int, str],
    k: int = 5,
) -> dict:
    print(class_label_mapping)
    top_k_indices = sorted(range(len(scores)), key=lambda i: scores[i], reverse=True)[
        :k
    ]
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
    ultralytics_results = model.detector(filepath)
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
        )
    ]
    selected_detection_record = select_best_animal_detection(detection_records)
    if not selected_detection_record:
        return {
            "filepath": str(filepath),
            "classifications": {},
            "detections": detection_records,
            "prediction": detection_records[0]["label"],
            "prediction_score": detection_records[0]["score"],
            "model_version": model_version,
        }

    else:
        xyxy = selected_detection_record["xyxy"]
        imagecv = cv2.imdecode(
            np.fromfile(filepath, dtype=np.uint8), cv2.IMREAD_UNCHANGED
        )
        croppedimage = crop_square_cv_to_pil(imagecv, xyxy)
        cropped_tensor = torch.ones((1, 3, crop_size, crop_size))
        cropped_tensor[0, :, :, :] = model.classifier.preprocessImage(croppedimage)
        scores = model.classifier.model.predict(cropped_tensor)
        classifications_record = (
            {}
            if not xyxy
            else to_classifications_record(
                scores[0].tolist(),
                class_label_mapping={
                    idx: label for idx, label in class_label_mapping.items()
                },
            )
        )
        return {
            "filepath": str(filepath),
            "classifications": classifications_record,
            "detections": detection_records,
            "prediction": classifications_record["labels"][0],
            "prediction_score": classifications_record["scores"][0],
            "model_version": model_version,
        }


filepath = Path("./data/badger.JPG")
filepath.exists()

model = load_model(
    filepath_detector_weights=Path("./MDV6-yolov10x.pt"),
    filepath_classifier_weights=Path(
        "./deepfaune-vit_large_patch14_dinov2.lvd142m.v3.pt"
    ),
    classifier_backbone=BACKBONE,
    classifier_crop_size=CROP_SIZE,
    classifier_num_classes=len(CLASS_LABEL_MAPPING),
)

print(predict(model=model, filepath=filepath, crop_size=CROP_SIZE))
