# Manual screenshots

Reproducible pipeline for the screenshots in the website manual (`website/docs/`).
Screenshots are captured by driving the dev app over the Chrome DevTools Protocol,
then post-processed (resize, optional macOS window framing) into
`website/docs/assets/images/`.

## Prerequisites

- The dev app running with remote debugging:

  ```bash
  DISPLAY=:1 npm run dev -- --remoteDebuggingPort 9222
  ```

- Studies imported (the shot scripts assume these exist; import scripts below create them):
  - Demo Dataset (`import-demo.mjs`)
  - GBIF: MICA Muskrat & Coypu (`import-gbif.mjs`), Waterleidingduinen Pilot 1 and
    Alpine Tundra Rodents (`import-gbif-generic.mjs` with `GBIF_DATASET` / `SHOT_PREFIX` env vars)
  - LILA: Biome Health Maasai Mara 2018 (`import-lila.mjs`)
- ImageMagick (`convert`) and the Playwright chromium cache
  (`~/.cache/ms-playwright/chromium-1223`, used by `frame.mjs` to render window chrome).

## Capturing

`driver.mjs` connects over CDP, emulates a MacBook Pro 14" viewport
(1512×982 @2x → 3024×1964 retina PNGs), and runs a shot script:

```bash
node scripts/manual-shots/driver.mjs scripts/manual-shots/<script>.mjs
```

Shot scripts (each saves into `scripts/manual-shots/raw/`):

| Script | Captures |
| --- | --- |
| `explore-state.mjs` | First-launch import screen |
| `list-catalogs.mjs` | GBIF / LILA catalog dropdowns |
| `shots-demo-tabs.mjs` | All six tabs of the demo study |
| `shots-hovercards.mjs` | Explore species + map-marker hovercards |
| `shots-media.mjs` / `shots-gallery.mjs` | Media grid/filters, gallery viewer, bboxes, shortcuts |
| `shots-settings.mjs` / `shots-remaining.mjs` | AI model zoo, export modal, explore charts, MICA overview |
| `shots-explore-charts.mjs` | Explore with the activity-charts row enabled |
| `shots-new-studies.mjs` / `shots-alpine-map.mjs` | Waterleidingduinen deployments, Alpine Tundra maps |
| `shots-batch2.mjs` / `shots-batch3.mjs` / `shots-row-detail.mjs` | Map encodings, media deployment hovercard, deployment line/heatmap/detail, best-capture hovercard |
| `shots-fixes.mjs` / `cleanup-dup*.mjs` | Demo import progress recapture + duplicate-study cleanup |

## Processing

```bash
bash scripts/manual-shots/process.sh
```

Maps raw captures to final image names, resizes them (1600px wide for guide shots,
1800px for heroes), and writes them to `website/docs/assets/images/`. Hero shots are
first wrapped in macOS window chrome on a transparent background by `frame.mjs`
(pass `--gradient` for an opaque backdrop).

## Previewing

```bash
cd website && make dev   # mkdocs serve
```

Guide images get rounded corners/border/shadow from
`website/docs/assets/stylesheets/extra.css` (`.screenshot`); heroes (`.hero`) carry
their own window chrome and shadow in the PNG.
