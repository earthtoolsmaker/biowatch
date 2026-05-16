#!/usr/bin/env python3
"""Build a MegaDetector model tarball ready to upload to huggingface.co/earthtoolsmaker/megadetector.

Downloads the official MDv6 release weights and the upstream LICENSE so AGPL attribution
travels with the binary, then tar-gzips them into a directory named for the version.

Usage:
    python scripts/build-megadetector-tarball.py --version 6.0

Produces dist/<version>.tar.gz alongside a summary of size + SHA256 + file list.
"""

import argparse
import hashlib
import shutil
import sys
import tarfile
import tempfile
import urllib.request
from pathlib import Path

WEIGHTS_URL = "https://zenodo.org/records/15398270/files/MDV6-yolov10-e-1280.pt?download=1"
WEIGHTS_FILENAME = "MDV6-yolov10-e-1280.pt"
WEIGHTS_SHA256 = "4a3a3d380ce7e151b2a8b991ab5d86f329ccd7b0b33e5d3ba0593a1166d55109"
LICENSE_URL = "https://raw.githubusercontent.com/microsoft/MegaDetector/main/LICENSE"
LICENSE_FILENAME = "LICENSE"


def download(url: str, dest: Path) -> None:
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


def build(version: str, output_dir: Path, work_dir: Path) -> Path:
    work_dir.mkdir(parents=True, exist_ok=True)
    output_dir.mkdir(parents=True, exist_ok=True)

    model_dir = work_dir / version
    if model_dir.exists():
        shutil.rmtree(model_dir)
    model_dir.mkdir()

    weights_path = model_dir / WEIGHTS_FILENAME
    download(WEIGHTS_URL, weights_path)

    actual_hash = sha256_of(weights_path)
    if WEIGHTS_SHA256 != "TBD_LOCK_ON_FIRST_RUN" and actual_hash != WEIGHTS_SHA256:
        raise RuntimeError(f"Weights SHA256 mismatch:\n  expected {WEIGHTS_SHA256}\n  got      {actual_hash}")
    print(f"[verify] {WEIGHTS_FILENAME} SHA256 = {actual_hash}")

    download(LICENSE_URL, model_dir / LICENSE_FILENAME)

    tarball = output_dir / f"{version}.tar.gz"
    if tarball.exists():
        tarball.unlink()
    print(f"[tar] {tarball}")
    with tarfile.open(tarball, "w:gz") as tar:
        tar.add(model_dir, arcname=version)
    return tarball


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", required=True, help="MegaDetector version, e.g. 6.0")
    parser.add_argument("--output-dir", type=Path, default=Path("dist"))
    parser.add_argument(
        "--work-dir",
        type=Path,
        default=Path(tempfile.gettempdir()) / "megadetector-build",
        help="Working directory for downloads (retained between runs)",
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
