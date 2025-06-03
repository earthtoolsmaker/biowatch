# common v0.1.0

This is the `common` python environment.
It currently contains all the dependencies necessary to run pytorch models
using a fastapi server. It also uses SpeciesNet.

## Approach

Running ML models will always happend behind a fastapi server where we can set
streaming HTTP responses so the the Electron Application can provide realtime
update to its UI based on the predictions made by the models.

We are currently evaluating LiteServe as our default abstraction for running
the ML Models.

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
run_speciesnet_server.py \
  --port 8000 \
  --model "v4.0.1a/"
```
