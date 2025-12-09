#!/usr/bin/env python
"""Download ML model weights from HuggingFace.

Usage:
    uv run python scripts/download_model.py --model speciesnet --output /tmp/models/speciesnet
    uv run python scripts/download_model.py --model deepfaune --output /tmp/models/deepfaune
    uv run python scripts/download_model.py --model manas --output /tmp/models/manas
"""

import argparse
import os
import tarfile

from huggingface_hub import hf_hub_download

MODELS = {
    "speciesnet": {
        "repo_id": "earthtoolsmaker/speciesnet",
        "filename": "4.0.1a.tar.gz",
    },
    "deepfaune": {
        "repo_id": "earthtoolsmaker/deepfaune",
        "filename": "1.3.tar.gz",
    },
    "manas": {
        "repo_id": "earthtoolsmaker/manas",
        "filename": "1.0.tar.gz",
    },
}


def download_model(model_name: str, output_dir: str) -> None:
    """Download and extract a model from HuggingFace."""
    if model_name not in MODELS:
        raise ValueError(f"Unknown model: {model_name}. Available: {list(MODELS.keys())}")

    config = MODELS[model_name]
    print(f"Downloading {model_name} from {config['repo_id']}...")

    tar_path = hf_hub_download(
        repo_id=config["repo_id"],
        filename=config["filename"],
        repo_type="model",
    )

    print(f"Extracting to {output_dir}...")
    os.makedirs(output_dir, exist_ok=True)
    with tarfile.open(tar_path, "r:gz") as tar:
        tar.extractall(output_dir)

    print(f"Done! Model extracted to {output_dir}")


def main():
    parser = argparse.ArgumentParser(description="Download ML model weights from HuggingFace")
    parser.add_argument(
        "--model",
        required=True,
        choices=list(MODELS.keys()),
        help="Model to download (speciesnet, deepfaune, manas)",
    )
    parser.add_argument(
        "--output",
        required=True,
        help="Output directory path",
    )
    args = parser.parse_args()

    download_model(args.model, args.output)


if __name__ == "__main__":
    main()
