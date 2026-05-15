#!/usr/bin/env python3
"""Extract SpeciesNet common-name snapshot from a labels.txt file.

The labels.txt format (one row per UUID):
    uuid;class;order;family;genus;species;commonName

Outputs JSON in the shape consumed by scripts/lib/aliases.js:
    {
      "modelId": "speciesnet",
      "modelVersion": "<X.Y.Za>",
      "source": "<descriptive source string>",
      "entries": [
        # binomial entries (genus and species both filled):
        {"scientificName": "<genus> <species>", "label": null, "commonName": "..."},
        # higher-rank entries (no genus or no species):
        {"scientificName": null, "label": "<commonName verbatim>", "commonName": "..."},
        ...
      ]
    }

Usage:
    python3 scripts/extract-speciesnet-labels.py \\
        --labels-file /tmp/speciesnet-402/4.0.2a/always_crop_99710272_22x8_v12_epoch_00148.labels.20251208.txt \\
        --version 4.0.2a \\
        --source-name 4.0.2a/always_crop_99710272_22x8_v12_epoch_00148.labels.20251208.txt \\
        --output src/shared/commonNames/sources/speciesnet.json
"""

import argparse
import json
from pathlib import Path


def parse_labels(labels_file: Path) -> list[dict]:
    entries = []
    for line in labels_file.read_text().splitlines():
        if not line:
            continue
        parts = line.split(";")
        if len(parts) != 7:
            continue
        _uuid, _cls, _order, _family, genus, species, common_name = parts
        if not common_name:
            continue
        if genus and species:
            entries.append(
                {
                    "scientificName": f"{genus} {species}",
                    "label": None,
                    "commonName": common_name,
                }
            )
        else:
            entries.append(
                {
                    "scientificName": None,
                    "label": common_name,
                    "commonName": common_name,
                }
            )
    return entries


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--labels-file", required=True, type=Path)
    parser.add_argument("--version", required=True, help="SpeciesNet version, e.g. 4.0.2a")
    parser.add_argument(
        "--source-name",
        required=True,
        help="Descriptive source string written into the snapshot, e.g. '4.0.2a/<labels-filename>'",
    )
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()

    entries = parse_labels(args.labels_file)
    snapshot = {
        "modelId": "speciesnet",
        "modelVersion": args.version,
        "source": f"{args.source_name} (earthtoolsmaker/speciesnet HF repo)",
        "entries": entries,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(snapshot, indent=2) + "\n")
    print(f"Wrote {len(entries)} entries to {args.output}")


if __name__ == "__main__":
    main()
