# Supported Formats

All the ways data gets in and out of Biowatch. For step-by-step instructions, see [Importing Data](../guides/importing-data.md) and [Exporting & Sharing](../guides/exporting-data.md).

## Import

| Format | What it is | What Biowatch reads |
| --- | --- | --- |
| **Camtrap DP** | [Camera Trap Data Package](https://camtrap-dp.tdwg.org/) (TDWG standard) | `datapackage.json`, `deployments.csv`, `media.csv`, `observations.csv`, plus media files when bundled |
| **GBIF** | Camtrap DP datasets published on [GBIF](https://www.gbif.org/) | Downloaded and imported as Camtrap DP, from a curated in-app catalog |
| **LILA / COCO Camera Traps** | [LILA BC](https://lila.science/) public datasets in [COCO Camera Traps](https://github.com/agentmorris/MegaDetector/blob/main/megadetector/data_management/README.md#coco-camera-traps-format) JSON | Labels, locations, and sequences; images are streamed from LILA's servers as you browse |
| **Wildlife Insights** | Project export from [Wildlife Insights](https://www.wildlifeinsights.org/) | `projects.csv`, `deployments.csv`, `images.csv` |
| **Deepfaune CSV** | Results CSV from the [DeepFaune desktop app](https://www.deepfaune.cnrs.fr/en/) | Image paths, species predictions, and confidence scores |
| **Images directory** | A folder of camera trap images on disk | EXIF timestamps; species detected with a [local AI model](../guides/ai-models.md) |

### Notes on imports

- **Species names** are matched against scientific names where available; common names are shown alongside them throughout the app.
- **Timestamps** are read as recorded by the camera. Images without EXIF timestamps are skipped by the directory importer.
- **Remote media** (GBIF, LILA) is cached locally after first view and can be cleared from study Settings → Cache.

## Export

| Format | Contents | Typical use |
| --- | --- | --- |
| **Camtrap DP** | `datapackage.json` + CSVs, optionally with media files; pick species, include/exclude blanks, control sequence grouping | Publishing to GBIF, moving to other platforms, archiving |
| **Media directories** | Images and videos copied into one folder per species | Training datasets, sharing highlights |
| **Deployments CSV** | One row per deployment: `deploymentID`, `locationID`, `locationName`, `latitude`, `longitude` | Bulk-editing names and coordinates in a spreadsheet, then re-importing |

### Notes on exports

- Camtrap DP exports validate against the [Camtrap DP 1.0 profile](https://camtrap-dp.tdwg.org/).
- Your annotations and corrections (species changes, added/deleted observations, bounding boxes) are included — exports reflect the current state of the study, not the original import.
- The Deployments CSV round-trips: empty cells leave existing values untouched, and coordinates must use a period as the decimal separator.
