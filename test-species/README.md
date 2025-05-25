# SpeciesNet Server

Start the server with default options:

```bash
uv run python run_server.py
```

Start the server and download from Kaggle using geofence:

```bash
uv run python run_server.py \
  --port 8001 \
  --timeout 45 \
  --model "kaggle:google/speciesnet/keras/v4.0.0a" \
  --geofence true
```
