.PHONY: install-dev lint lint-fix format format-check test test-debug download-models

# Install dev dependencies
install-dev:
	uv sync --extra dev

# Run ruff linter (check only)
lint:
	uv run ruff check .

# Run ruff linter and auto-fix issues
lint-fix:
	uv run ruff check --fix .

# Format code with ruff
format:
	uv run ruff format .

# Check formatting without making changes
format-check:
	uv run ruff format --check .

# Environment variables for test model paths
export SPECIESNET_MODEL_PATH=/tmp/models/speciesnet/4.0.1a
export DEEPFAUNE_DETECTOR_WEIGHTS=/tmp/models/deepfaune/1.3/MDV6-yolov10x.pt
export DEEPFAUNE_CLASSIFIER_WEIGHTS=/tmp/models/deepfaune/1.3/deepfaune-vit_large_patch14_dinov2.lvd142m.v3.pt
export MANAS_DETECTOR_WEIGHTS=/tmp/models/manas/1.0/MDV6-yolov10x.pt
export MANAS_CLASSIFIER_WEIGHTS=/tmp/models/manas/1.0/best_model_Fri_Sep__1_18_50_55_2023.pt
export MANAS_CLASSES=/tmp/models/manas/1.0/classes_Fri_Sep__1_18_50_55_2023.pickle

# Run all e2e tests (downloads models if not present)
test: download-models
	uv run pytest tests/ -v

# Run tests with verbose output and no capture
test-debug: download-models
	uv run pytest tests/ -v -s --tb=long

# Download all ML model weights from HuggingFace
download-models:
	uv run python scripts/download_model.py --model speciesnet --output /tmp/models/speciesnet
	uv run python scripts/download_model.py --model deepfaune --output /tmp/models/deepfaune
	uv run python scripts/download_model.py --model manas --output /tmp/models/manas
