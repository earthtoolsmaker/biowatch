# Troubleshooting

Common issues and how to resolve them. If you're stuck on something not listed here, [open an issue on GitHub](https://github.com/earthtoolsmaker/biowatch/issues) or [get in touch](https://www.earthtoolsmaker.org/contact/).

## Imports

**"No images found" when importing a folder**
:   The directory importer looks for image files with EXIF data. Check that the folder actually contains images (not only videos or RAW files) and that they carry EXIF timestamps — images without a capture date are skipped.

**Camtrap DP import fails**
:   Biowatch needs the folder (or zip) to contain a `datapackage.json` at its root, alongside `deployments.csv`, `media.csv`, and `observations.csv`. Exports from Agouti and GBIF downloads have this structure; if you've re-zipped a package, make sure the files aren't nested inside an extra directory level.

**A GBIF or LILA import is slow**
:   These imports download the dataset's metadata up front — for large datasets (hundreds of thousands of observations) this can take several minutes. The progress dialog shows which phase is running; imports can be cancelled at any time.

## Media display

**Thumbnails are missing or gray for an online study**
:   Studies imported from GBIF or LILA stream their images from the publisher's servers, so the first view of each image needs an internet connection. Once viewed, images are cached locally (study Settings → Cache) and work offline.

**My own images stopped displaying**
:   Biowatch references your original files where they are on disk — it doesn't copy them. If you move or rename the folder after importing, the links break. Check the **Sources** tab to see which paths the study expects.

**Images of people look redacted**
:   That's intentional: media classified as human is blurred in the grid by default, to protect the privacy of people walking past your cameras.

**A video won't play immediately**
:   Many camera traps record AVI/MJPEG, which browsers can't play natively. Biowatch transcodes such clips on first playback — a short delay is normal, and the converted copy is cached for next time.

## AI models

**A model download fails or stalls**
:   Models are large (120 MB – 1.2 GB) and download together with their Python environment on first install. Check your connection and retry from Settings → AI Models; partially downloaded models can be deleted and re-downloaded.

**Processing seems slow**
:   Models run entirely on your machine, so speed depends on your hardware. As a rough guide, expect a few images per second on a modern laptop. The scan continues in the background — you can browse the study while it runs.

## Data and disk space

**Where is my data stored?**
:   Each study lives in a `biowatch-data/studies/<id>` folder inside the app's data directory: `%APPDATA%\Biowatch` on Windows, `~/Library/Application Support/Biowatch` on macOS, and `~/.config/biowatch` on Linux. Downloaded AI models live next to it under `biowatch-data/model-zoo`.

**Biowatch is using a lot of disk space**
:   Caches of remote images, thumbnails, and transcoded videos accumulate per study. Check study Settings → Cache for a breakdown and a **Clear** button — cleared files are regenerated on demand. Deleting unused AI models (Settings → AI Models) frees the most space at once.

**Does deleting a study delete my images?**
:   No. Deleting a study removes Biowatch's database, caches, and metadata for it — your original image and video files on disk are never touched.
