# HTTP ML Model Servers

This document explains how HTTP-based machine learning model servers work in Biowatch, how to add new models, and the overall architecture.

## Overview

Biowatch uses an **HTTP-based ML model serving architecture** where each machine learning model runs as an isolated Python HTTP server. This design provides:

- **Process isolation**: Each model runs in its own Python process, preventing memory leaks or crashes from affecting the main application
- **Standard REST API**: All models expose the same HTTP endpoints, making integration consistent
- **Streaming support**: Predictions are streamed as they complete, enabling real-time progress feedback
- **Hardware flexibility**: Models automatically detect and use available GPU/CPU resources

### Supported Models

| Model | Focus | Species Coverage |
|-------|-------|------------------|
| **SpeciesNet** (Google) | Global wildlife | 2,000+ species worldwide |
| **DeepFaune** (CNRS) | European fauna | 34 European species |
| **Manas** (OSI-Panthera) | Central Asian fauna | Snow leopard and 11 regional species |

### Technology Stack

- **[LitServe](https://lightning.ai/docs/litserve)**: High-performance ML serving framework built on FastAPI
- **Python**: Model inference and HTTP server
- **Electron IPC**: Communication between main process and renderer

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Biowatch Application                         │
│                                                                 │
│  ┌──────────────┐    IPC     ┌─────────────────────────────┐   │
│  │   Renderer   │◄──────────►│      Main Process           │   │
│  │   (React)    │            │                             │   │
│  │              │            │  ┌─────────────────────┐    │   │
│  │ models.jsx   │            │  │   server.ts         │    │   │
│  │ - UI controls│            │  │ - start/stop server │    │   │
│  │ - status     │            │  │ - health checks     │    │   │
│  └──────────────┘            │  │ - process lifecycle │    │   │
│                              │  └──────────┬──────────┘    │   │
│                              │             │               │   │
│                              │  ┌──────────┴──────────┐    │   │
│                              │  │   importer.js       │    │   │
│                              │  │ - fetch predictions │    │   │
│                              │  │ - parse responses   │    │   │
│                              │  │ - store to database │    │   │
│                              │  └─────────────────────┘    │   │
│                              └─────────────┼───────────────┘   │
└────────────────────────────────────────────┼───────────────────┘
                                             │ spawn Python process
                                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Python HTTP Server (LitServe)                │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Standard Endpoints:                                     │   │
│  │                                                          │   │
│  │  GET  /health    → Returns "ok" when server is ready     │   │
│  │  GET  /info      → Server and model metadata             │   │
│  │  POST /predict   → Streaming predictions (main endpoint) │   │
│  │  POST /shutdown  → Graceful shutdown (requires API key)  │   │
│  │  GET  /docs      → Interactive Swagger documentation     │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Model-specific implementation:                                 │
│  - run_speciesnet_server.py                                    │
│  - run_deepfaune_server.py                                     │
│  - run_manas_server.py                                         │
└─────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
src/
├── shared/
│   └── mlmodels.js                      # Model zoo configuration (all models defined here)
├── main/
│   └── services/
│       ├── ml/
│       │   ├── server.ts                # Server lifecycle management (start/stop/health)
│       │   ├── download.ts              # Model download and installation
│       │   └── paths.ts                 # Path utilities for models/environments
│       └── import/
│           └── importer.js              # Prediction consumer (fetches and stores results)
├── preload/
│   └── index.js                         # IPC bridge (exposes APIs to renderer)
└── renderer/src/
    └── models.jsx                       # UI component for model management

python-environments/common/
├── run_speciesnet_server.py    # SpeciesNet LitServe implementation
├── run_deepfaune_server.py     # DeepFaune LitServe implementation
└── run_manas_server.py         # Manas LitServe implementation
```

## How HTTP Servers Work

### Server Startup Flow

When a user clicks "Run" on a model, the following sequence occurs:

```
1. Port Allocation
   └─► Development: Fixed ports (8000, 8001, 8002)
   └─► Production: Dynamic port via findFreePort()

2. Process Spawn
   └─► Main process spawns Python interpreter
   └─► Passes model weights path and configuration as CLI args
   └─► Sets LIT_SHUTDOWN_API_KEY environment variable

3. Health Check Polling
   └─► Poll GET /health every 1 second
   └─► Maximum 30 retries (30 seconds timeout)
   └─► Server is ready when /health returns 200 OK

4. Ready State
   └─► Return port, process ID, and shutdown API key to renderer
   └─► UI shows server info and API documentation link
```

**Key function**: `startAndWaitTillServerHealty()` in `src/main/services/ml/server.ts`

```javascript
// Health check polling loop
for (let i = 0; i < maxRetries; i++) {
  try {
    const healthCheck = await fetch(healthEndpoint, { method: 'GET', timeout: 1000 })
    if (healthCheck.ok) {
      log.info('Server is ready')
      return pythonProcess
    }
  } catch (error) {
    // Server not ready yet, will retry
  }
  await new Promise((resolve) => setTimeout(resolve, retryInterval))
}
```

### Prediction Request Flow

```
1. Batch Preparation
   └─► Importer fetches up to 5 pending images from database

2. HTTP POST Request
   └─► POST /predict with JSON body containing file paths
   └─► Content-Type: application/json

3. Streaming Response
   └─► Server processes images one by one
   └─► Each prediction is yielded as newline-delimited JSON
   └─► Client parses chunks as they arrive

4. Database Storage
   └─► Each prediction is stored immediately
   └─► Includes raw model output, parsed species, bounding boxes
```

**Key function**: `getPredictions()` generator in `src/main/services/import/importer.js`

```javascript
async function* getPredictions({ imagesPath, port, signal }) {
  const response = await fetch(`http://localhost:${port}/predict`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instances: imagesPath.map((path) => ({ filepath: path })) }),
    signal
  })

  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const chunk = decoder.decode(value)
    const lines = chunk.trim().split('\n')
    for (const line of lines) {
      if (line.trim()) {
        const response = JSON.parse(line)
        for (const pred of response.output.predictions) {
          yield pred
        }
      }
    }
  }
}
```

### Graceful Shutdown

Servers support graceful shutdown via a secure API endpoint:

```
1. Shutdown Request
   └─► POST /shutdown with Authorization: Bearer {shutdownApiKey}

2. Wait for Exit
   └─► Poll process status every 500ms
   └─► Maximum 10 seconds wait time

3. Fallback
   └─► If graceful shutdown times out, send SIGKILL
```

**Key function**: `stopMLModelHTTPServer()` in `src/main/services/ml/server.ts`

```javascript
// Try graceful shutdown first
const shutdownResponse = await fetch(`http://localhost:${port}/shutdown`, {
  method: 'POST',
  headers: {
    Accept: 'application/json',
    Authorization: `Bearer ${shutdownApiKey}`
  }
})
```

## Model Configuration

### Model Zoo Schema

All models are defined in `src/shared/mlmodels.js`. Each model entry has the following structure:

```javascript
{
  // Unique identifier and version
  reference: { id: 'model-id', version: '1.0' },

  // Python environment to use (must match an entry in pythonEnvironments)
  pythonEnvironment: { id: 'common', version: '0.1.3' },

  // Display information
  name: 'Model Display Name',
  description: 'Description shown in the UI...',
  website: 'https://model-homepage.com',
  logo: 'logo-key',  // Maps to an asset

  // Download configuration
  downloadURL: 'https://huggingface.co/.../model.tar.gz?download=true',
  size_in_MB: 500,
  files: 3,  // Number of files in the archive

  // Inference configuration
  detectionConfidenceThreshold: 0.5  // Minimum confidence for detections
}
```

### Python Environment Schema

```javascript
{
  type: 'conda',
  reference: { id: 'common', version: '0.1.3' },
  platform: {
    mac: {
      downloadURL: 'https://.../common-0.1.3-macOS.tar.gz',
      size_in_MB: 354,
      size_in_MB_installed: 1300,
      files: 55470
    },
    linux: { /* ... */ },
    windows: { /* ... */ }
  }
}
```

### Example: SpeciesNet Configuration

```javascript
{
  reference: { id: 'speciesnet', version: '4.0.1a' },
  pythonEnvironment: { id: 'common', version: '0.1.3' },
  name: 'SpeciesNet',
  size_in_MB: 468,
  files: 6,
  downloadURL: 'https://huggingface.co/earthtoolsmaker/speciesnet/resolve/main/4.0.1a.tar.gz?download=true',
  description: "Google's SpeciesNet is an open-source AI model...",
  website: 'https://github.com/google/cameratrapai',
  logo: 'google',
  detectionConfidenceThreshold: 0.5
}
```

## Adding a New ML Model

Follow these steps to add a new ML model to Biowatch.

### Step 1: Create the Python Server Script

Create a new file `python-environments/common/run_yourmodel_server.py`:

```python
"""
CLI script to run YourModel as a LitServer.

Start the server:
  python run_yourmodel_server.py --port 8000 --filepath-weights /path/to/weights.pt

Endpoints:
  GET  /health  → Health check
  GET  /info    → Model metadata
  POST /predict → Streaming predictions
  GET  /docs    → Swagger documentation
"""

import litserve as ls
from absl import app, flags
from fastapi import HTTPException
from pathlib import Path

# Define CLI flags
_PORT = flags.DEFINE_integer("port", 8000, "Port to run the server on.")
_TIMEOUT = flags.DEFINE_integer("timeout", 30, "Timeout for requests.")
_FILEPATH_WEIGHTS = flags.DEFINE_string(
    "filepath-weights", None, "Path to model weights", required=True
)


class YourModelLitAPI(ls.LitAPI):
    """LitServe API implementation for YourModel."""

    def __init__(self, filepath_weights: Path, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.filepath_weights = filepath_weights

    def setup(self, device):
        """Load the model. Called once when server starts."""
        # Load your model here
        # self.model = load_model(self.filepath_weights)
        pass

    def decode_request(self, request, **kwargs):
        """Validate and decode the incoming request."""
        for instance in request["instances"]:
            filepath = instance["filepath"]
            if not Path(filepath).exists():
                raise HTTPException(400, f"Cannot access filepath: `{filepath}`")
        return request

    def predict(self, x, **kwargs):
        """
        Run inference. This is a generator that yields predictions one by one.
        Streaming is enabled by using yield instead of return.
        """
        for instance in x["instances"]:
            filepath = instance["filepath"]

            # Run your model inference here
            # prediction = self.model.predict(filepath)

            prediction_dict = {
                "predictions": [{
                    "filepath": str(filepath),
                    "prediction": "species_name",
                    "prediction_score": 0.95,
                    "classifications": {
                        "classes": ["species1", "species2"],
                        "scores": [0.95, 0.03]
                    },
                    "detections": [{
                        "label": "animal",
                        "conf": 0.98,
                        "bbox": [0.1, 0.2, 0.5, 0.6]
                    }],
                    "model_version": "1.0"
                }]
            }
            yield prediction_dict

    def encode_response(self, output, **kwargs):
        """Encode the prediction output for streaming."""
        for out in output:
            yield {"output": out}


def main(argv):
    api = YourModelLitAPI(
        filepath_weights=Path(_FILEPATH_WEIGHTS.value),
        api_path="/predict",
        stream=True,  # Enable streaming
    )
    model_metadata = {"name": "YourModel", "type": "yourmodel", "version": "1.0"}
    server = ls.LitServer(
        api,
        accelerator="auto",
        devices="auto",
        workers_per_device=1,
        model_metadata=model_metadata,
        timeout=_TIMEOUT.value,
        enable_shutdown_api=True,  # Enable /shutdown endpoint
    )
    server.run(port=_PORT.value, generate_client_file=False)


if __name__ == "__main__":
    app.run(main)
```

**Reference implementations:**
- `python-environments/common/run_speciesnet_server.py` - Uses external library
- `python-environments/common/run_deepfaune_server.py` - Custom model loading

### Step 2: Register Model in Model Zoo

Add an entry to `modelZoo` in `src/shared/mlmodels.js`:

```javascript
export const modelZoo = [
  // ... existing models ...
  {
    reference: { id: 'yourmodel', version: '1.0' },
    pythonEnvironment: { id: 'common', version: '0.1.3' },
    name: 'YourModel',
    size_in_MB: 500,  // Size of the downloaded archive
    files: 3,          // Number of files in the archive
    downloadURL: 'https://your-model-host.com/yourmodel-1.0.tar.gz',
    description: 'Description of what your model does...',
    website: 'https://your-model-website.com',
    logo: 'yourlogo',  // Add corresponding logo asset
    detectionConfidenceThreshold: 0.5
  }
]
```

### Step 3: Add Server Startup Function

Add a new function in `src/main/services/ml/server.ts`:

```typescript
async function startYourModelHTTPServer({
  port,
  weightsFilepath,
  timeout,
  pythonEnvironment
}) {
  log.info('Starting YourModel HTTP Server')

  const localInstalRootDirPythonEnvironment = join(
    getMLModelEnvironmentLocalInstallPath({ ...pythonEnvironment.reference }),
    pythonEnvironment.reference.id
  )

  const scriptPath = is.dev
    ? join(__dirname, '../../python-environments/common/run_yourmodel_server.py')
    : join(process.resourcesPath, 'python-environments', 'common', 'run_yourmodel_server.py')

  const pythonInterpreter = is.dev
    ? join(__dirname, '../../python-environments/common/.venv/bin/python')
    : os.platform() === 'win32'
      ? join(localInstalRootDirPythonEnvironment, 'python.exe')
      : join(localInstalRootDirPythonEnvironment, 'bin', 'python')

  const scriptArgs = [
    '--port', port,
    '--filepath-weights', weightsFilepath,
    '--timeout', timeout
  ]

  const shutdownApiKey = crypto.randomUUID()

  const pythonProcess = await startAndWaitTillServerHealty({
    pythonInterpreter,
    scriptPath,
    scriptArgs,
    healthEndpoint: `http://localhost:${port}/health`,
    env: { LIT_SHUTDOWN_API_KEY: shutdownApiKey }
  })

  return { process: pythonProcess, shutdownApiKey }
}
```

### Step 4: Register in Main Switch Statement

Add a case to `startMLModelHTTPServer()` in `src/main/services/ml/server.ts`:

```typescript
async function startMLModelHTTPServer({ pythonEnvironment, modelReference, country = null }) {
  switch (modelReference.id) {
    // ... existing cases ...

    case 'yourmodel': {
      const port = is.dev ? 8003 : await findFreePort()
      const localInstallPath = getMLModelLocalInstallPath({ ...modelReference })
      const weightsFilepath = join(localInstallPath, 'model_weights.pt')

      const { process: pythonProcess, shutdownApiKey } = await startYourModelHTTPServer({
        port,
        weightsFilepath,
        timeout: 30,
        pythonEnvironment
      })

      return { port, process: pythonProcess, shutdownApiKey }
    }

    default: {
      log.warn(`Not implemented for ${modelReference.id}`)
      return { port: null, process: null, shutdownApiKey: null }
    }
  }
}
```

### Step 5: Handle Prediction Output (If Needed)

If your model's prediction format differs from existing models, update the parsing logic in `src/main/services/import/importer.js`:

```javascript
function parseScientificName({ modelId, label }) {
  switch (modelId) {
    // ... existing cases ...

    case 'yourmodel':
      // Parse your model's prediction format
      if (label === 'blank' || label === 'empty') return null
      return label  // Or transform as needed

    default:
      return null
  }
}
```

### Step 6: Test the Integration

1. **Start the application in development mode:**
   ```bash
   npm run dev
   ```

2. **Download the model** from the Models tab

3. **Start the server** and verify:
   - Health check: `curl http://localhost:8003/health`
   - Model info: `curl http://localhost:8003/info`
   - API docs: Open `http://localhost:8003/docs` in browser

4. **Run predictions** on a study with images

5. **Check logs** for any errors:
   ```bash
   # View Electron main process logs
   tail -f ~/.config/biowatch/logs/main.log
   ```

## API Reference

### Standard Endpoints

All HTTP ML model servers expose these endpoints via LitServe:

#### GET /health

Returns server health status.

**Response:**
```
"ok"
```

**Status codes:**
- `200`: Server is healthy and ready
- `503`: Server is starting up or unhealthy

#### GET /info

Returns server and model metadata.

**Response:**
```json
{
  "model": {
    "name": "speciesnet",
    "type": "speciesnet",
    "version": "4.0.1a"
  },
  "server": {
    "devices": [["cuda:0"]],
    "workers_per_device": 1,
    "timeout": 30,
    "stream": true,
    "max_payload_size": null,
    "track_requests": false
  }
}
```

#### POST /predict

Run inference on images. Supports streaming responses.

**Request:**
```json
{
  "instances": [
    { "filepath": "/path/to/image1.jpg" },
    { "filepath": "/path/to/image2.jpg" }
  ]
}
```

**Response (streaming, newline-delimited JSON):**
```json
{"output": {"predictions": [{"filepath": "/path/to/image1.jpg", "prediction": "species_name", "prediction_score": 0.95, ...}]}}
{"output": {"predictions": [{"filepath": "/path/to/image2.jpg", "prediction": "other_species", "prediction_score": 0.87, ...}]}}
```

**Prediction object fields:**
| Field | Type | Description |
|-------|------|-------------|
| `filepath` | string | Path to the processed image |
| `prediction` | string | Top predicted class/species |
| `prediction_score` | number | Confidence score (0-1) |
| `classifications` | object | All class scores (top-k) |
| `detections` | array | Bounding boxes for detected animals |
| `model_version` | string | Version of the model used |

#### POST /shutdown

Gracefully shut down the server. Requires API key authentication.

**Headers:**
```
Authorization: Bearer {shutdownApiKey}
```

**Response:** Server begins shutdown process

#### GET /docs

Interactive Swagger/OpenAPI documentation (browser-friendly).

## Troubleshooting

### Server Fails to Start (Timeout)

**Symptom:** "Server failed to start in the expected time" error

**Causes and solutions:**
1. **Model weights not found**: Verify the model is fully downloaded
2. **Insufficient memory**: Close other applications, check system RAM
3. **GPU initialization slow**: First startup with GPU can take longer; increase timeout if needed
4. **Python environment corrupted**: Delete and re-download the environment

**Debug:** Check logs at `~/.config/biowatch/logs/main.log`

### Port Already in Use

**Symptom:** Server starts but health check fails

**Solution:**
```bash
# Find what's using the port
lsof -i :8000

# Kill the process if it's a stale Biowatch server
kill -9 <PID>
```

### Model Weights Not Found

**Symptom:** Python error about missing file

**Solution:**
1. Check model download completed (no partial download)
2. Verify path in logs matches actual file location
3. Re-download the model if corrupted

### Python Environment Issues

**Symptom:** Import errors or missing modules

**Solution:**
1. Delete the Python environment directory
2. Re-download from the Models tab
3. Check that the environment version matches the model requirement

### Memory/GPU Problems

**Symptom:** Out of memory errors, slow inference

**Solutions:**
- **GPU memory**: Close other GPU-intensive applications
- **System RAM**: Ensure at least 8GB available for most models
- **CPU fallback**: Models will automatically use CPU if no GPU is available (slower but works)

## Best Practices

### For Model Development

1. **Keep server scripts self-contained**: Include all model-specific logic in the server script
2. **Follow the streaming pattern**: Use `yield` in `predict()` for real-time feedback
3. **Set appropriate timeouts**: 30 seconds is default; increase for slower models
4. **Handle edge cases**: Return meaningful predictions for empty images, corrupted files
5. **Test with various image formats**: JPEG, PNG, different resolutions

### For Performance

1. **Batch size**: Current implementation processes 5 images per batch
2. **GPU utilization**: LitServe automatically uses available GPU
3. **Memory management**: Models are loaded once at startup, not per-request

### For Debugging

1. **Check health endpoint first**: `curl http://localhost:{port}/health`
2. **Use the Swagger docs**: Available at `/docs` for interactive testing
3. **Monitor logs**: Both Electron main process and Python stderr
4. **Test with curl**: Isolate issues by testing the HTTP API directly

## Resources

- [LitServe Documentation](https://lightning.ai/docs/litserve) - HTTP ML serving framework
- [SpeciesNet Repository](https://github.com/google/cameratrapai) - Google's camera trap AI
- [DeepFaune Website](https://www.deepfaune.cnrs.fr/en/) - CNRS European fauna model
- [Manas Model](https://huggingface.co/Hex-Data/Panthera) - Snow leopard classifier
- [Drizzle ORM Guide](drizzle.md) - Database migrations documentation
