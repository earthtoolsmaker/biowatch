#!/usr/bin/env python
"""Extract DeepFaune class labels from run_deepfaune_server.py and write JSON snapshot.

DeepFaune labels are informal common-name-ish English strings like "red deer",
"chamois", "bird". They are not binomial scientific names. The snapshot stores
each label with scientificName=null and commonName=titleCase(label).

Usage:
    python scripts/extract-deepfaune-labels.py \
        --server-file python-environments/common/run_deepfaune_server.py \
        --output src/shared/commonNames/sources/deepfaune.json
"""

import argparse
import ast
import json
from pathlib import Path


def extract_class_label_mapping(server_file: Path) -> dict[int, str]:
    """Parse run_deepfaune_server.py and return the CLASS_LABEL_MAPPING dict."""
    tree = ast.parse(server_file.read_text())
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and node.targets[0].id == "CLASS_LABEL_MAPPING"
        ):
            return ast.literal_eval(node.value)
    raise RuntimeError("CLASS_LABEL_MAPPING not found in server file")


def title_case(label: str) -> str:
    """Simple title-casing for display: 'red deer' -> 'Red Deer'."""
    return " ".join(word.capitalize() for word in label.split())


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--server-file", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    mapping = extract_class_label_mapping(args.server_file)
    entries = [
        {"scientificName": None, "label": label, "commonName": title_case(label)}
        for _, label in sorted(mapping.items())
    ]

    snapshot = {
        "modelId": "deepfaune",
        "modelVersion": "1.3",
        "source": str(args.server_file),
        "entries": entries,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, indent=2) + "\n")
    print(f"Wrote {len(entries)} entries to {args.output}")


if __name__ == "__main__":
    main()
