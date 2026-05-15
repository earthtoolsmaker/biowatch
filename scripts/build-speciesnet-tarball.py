#!/usr/bin/env python3
"""Build a SpeciesNet model tarball ready to upload to huggingface.co/earthtoolsmaker/speciesnet.

Pulls the classifier weights, labels, taxonomy, and geofence from Kaggle's public
SpeciesNet model archive; bundles the MegaDetector weights so the model is fully
offline after the user's first download; rewrites info.json's detector field to
point at the local filename; and tar-gzips the result.

Usage:
    python scripts/build-speciesnet-tarball.py --version 4.0.2a

Produces dist/<version>.tar.gz alongside a summary of size + SHA256 + file list.
"""

import argparse
import hashlib
import json
import shutil
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

KAGGLE_URL_TEMPLATE = "https://www.kaggle.com/api/v1/models/google/speciesnet/pyTorch/v{version}/1/download"
MEGADETECTOR_URL = "https://github.com/agentmorris/MegaDetector/releases/download/v5.0/md_v5a.0.0.pt"
MEGADETECTOR_FILENAME = "md_v5a.0.0.pt"
MEGADETECTOR_SHA256 = "94e88fe97c8050f2e3d0cc4cb4f64729d639d74312dcbe2f74f8eecd3b01b276"


def download(url: str, dest: Path) -> None:
    """Stream a URL to disk with a coarse progress indicator.

    On a TTY: live-updating single-line progress.
    Off a TTY (logs, CI): one line per 10% milestone.
    """
    if dest.exists():
        print(f"[skip] {dest.name} already present ({dest.stat().st_size / 1e6:.0f} MB)")
        return

    print(f"[download] {url}")
    is_tty = sys.stdout.isatty()
    last_milestone = -1

    def report(block_num: int, block_size: int, total_size: int) -> None:
        nonlocal last_milestone
        if total_size <= 0:
            return
        downloaded = block_num * block_size
        pct = min(100, downloaded * 100 // total_size)
        if is_tty:
            sys.stdout.write(f"\r  {pct:3d}%  {downloaded / 1e6:7.1f} / {total_size / 1e6:.0f} MB")
            sys.stdout.flush()
        else:
            milestone = pct // 10
            if milestone > last_milestone:
                last_milestone = milestone
                print(f"  {pct:3d}%  {downloaded / 1e6:7.1f} / {total_size / 1e6:.0f} MB")

    urllib.request.urlretrieve(url, dest, reporthook=report)
    if is_tty:
        sys.stdout.write("\n")


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fp:
        for chunk in iter(lambda: fp.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def rewrite_info_json(info_path: Path) -> None:
    """Replace the detector URL with the bundled local filename."""
    info = json.loads(info_path.read_text())
    if info.get("detector") == MEGADETECTOR_FILENAME:
        return
    info["detector"] = MEGADETECTOR_FILENAME
    info_path.write_text(json.dumps(info, indent=4) + "\n")
    print(f"[info.json] detector → {MEGADETECTOR_FILENAME}")


def build(version: str, output_dir: Path, work_dir: Path) -> Path:
    work_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    kaggle_archive = work_dir / f"kaggle-{version}.tar.gz"
    download(KAGGLE_URL_TEMPLATE.format(version=version), kaggle_archive)

    model_dir = work_dir / version
    if model_dir.exists():
        shutil.rmtree(model_dir)
    model_dir.mkdir()

    print(f"[extract] {kaggle_archive.name} → {model_dir}/")
    with tarfile.open(kaggle_archive) as tar:
        tar.extractall(model_dir, filter="data")

    readme = model_dir / "README.md"
    if readme.exists():
        readme.unlink()
        print("[drop] README.md")

    detector_path = model_dir / MEGADETECTOR_FILENAME
    download(MEGADETECTOR_URL, detector_path)

    actual_hash = sha256_of(detector_path)
    if actual_hash != MEGADETECTOR_SHA256:
        raise RuntimeError(f"MegaDetector SHA256 mismatch:\n  expected {MEGADETECTOR_SHA256}\n  got      {actual_hash}")
    print("[verify] MegaDetector SHA256 ✓")

    rewrite_info_json(model_dir / "info.json")

    tarball = output_dir / f"{version}.tar.gz"
    if tarball.exists():
        tarball.unlink()
    print(f"[tar] {tarball}")
    with tarfile.open(tarball, "w:gz") as tar:
        tar.add(model_dir, arcname=version)

    return tarball


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True, help="SpeciesNet version, e.g. 4.0.2a")
    parser.add_argument("--output-dir", type=Path, default=Path("dist"))
    parser.add_argument(
        "--work-dir",
        type=Path,
        default=Path(tempfile.gettempdir()) / "speciesnet-build",
        help="Working directory for downloads + extraction (retained between runs)",
    )
    args = parser.parse_args()

    tarball = build(args.version, args.output_dir, args.work_dir)

    size_mb = tarball.stat().st_size / 1e6
    digest = sha256_of(tarball)
    with tarfile.open(tarball) as tar:
        members = sorted(m.name for m in tar.getmembers() if not m.isdir())

    print()
    print("=" * 60)
    print(f"  Tarball:  {tarball}")
    print(f"  Size:     {size_mb:.1f} MB")
    print(f"  SHA256:   {digest}")
    print("  Contents:")
    for name in members:
        print(f"    {name}")
    print("=" * 60)


if __name__ == "__main__":
    main()
