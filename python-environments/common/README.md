# common v0.1.3

This is the `common` python environment.
It currently contains all the dependencies necessary to run pytorch models
using a fastapi server. It also uses SpeciesNet.

## Approach

Running ML models will always happend behind a fastapi server where we can set
streaming HTTP responses so the the Electron Application can provide realtime
update to its UI based on the predictions made by the models.

We are currently evaluating LiteServe as our default abstraction for running
the ML Models.

## Python Version

Python versions are pinned to very specific version numbers in
[pyproject.toml](./pyproject.toml) and [.python-version](./.python-version)

Currently, it is set to `python==3.12`

## ML Models

### SpeciesNet

Start the server with default options:

```bash
uv run python run_speciesnet_server.py
```

Start the server and download from Kaggle using geofence:

```bash
uv run python run_speciesnet_server.py \
  --port 8001 \
  --timeout 45 \
  --model "kaggle:google/speciesnet/keras/v4.0.0a" \
  --geofence true
```

Load the SpeciesNet Model from a folder and start the server:

```bash
uv run python run_speciesnet_server.py \
  --port 8000 \
  --model "v4.0.1a/"
```

### Deepfaune

Deepfaune is a wildlife detection and classification model for Alpine/European
fauna. It uses a YOLO detector (MDV6-yolov10x) and a ViT Large classifier with
DinoV2 backbone.

Start the server with required weights:

```bash
uv run python run_deepfaune_server.py \
  --filepath-detector-weights ./path/to/weights/MDV6-yolov10x.pt \
  --filepath-classifier-weights ./path/to/weights/deepfaune-vit_large_patch14_dinov2.lvd142m.v3.pt
```

Start the server with all options:

```bash
uv run python run_deepfaune_server.py \
  --port 8000 \
  --timeout 30 \
  --workers_per_device 1 \
  --backlog 2048 \
  --filepath-detector-weights ./path/to/weights/MDV6-yolov10x.pt \
  --filepath-classifier-weights ./path/to/weights/deepfaune-vit_large_patch14_dinov2.lvd142m.v3.pt
```

### Manas

Manas is a wildlife classifier developed by OSI-Panthera and Hex Data for
classifying wildlife species from camera trap images in Kyrgyzstan, focusing on
snow leopard (panthera uncia) and other regional fauna. It uses a YOLO detector
(MDV6-yolov10x) and an EfficientNet V2 Large classifier.

Start the server with required weights:

```bash
uv run python run_manas_server.py \
  --filepath-detector-weights ./path/to/weights/MDV6-yolov10x.pt \
  --filepath-classifier-weights ./path/to/weights/best_model_Fri_Sep__1_18_50_55_2023.pt \
  --filepath-classes ./path/to/classes/classes_Fri_Sep__1_18_50_55_2023.pickle
```

Start the server with all options:

```bash
uv run python run_manas_server.py \
  --port 8002 \
  --timeout 30 \
  --workers_per_device 1 \
  --backlog 2048 \
  --filepath-detector-weights ./path/to/weights/MDV6-yolov10x.pt \
  --filepath-classifier-weights ./path/to/weights/best_model_Fri_Sep__1_18_50_55_2023.pt \
  --filepath-classes ./path/to/classes/classes_Fri_Sep__1_18_50_55_2023.pickle
```