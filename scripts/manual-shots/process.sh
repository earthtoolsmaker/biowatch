#!/usr/bin/env bash
# Process raw captures into website manual images.
# Heroes get macOS window framing (frame.mjs); guide shots are resized copies.
set -euo pipefail

cd "$(dirname "$0")/../.."
RAW=scripts/manual-shots/raw
OUT=website/docs/assets/images
mkdir -p "$OUT"

# --- Heroes: macOS window chrome, transparent backdrop ---
node scripts/manual-shots/frame.mjs "$RAW/10-demo-overview.png" /tmp/hero-overview.png "Biowatch"
node scripts/manual-shots/frame.mjs "$RAW/26-explore-activity-charts.png" /tmp/hero-explore.png "Biowatch"
node scripts/manual-shots/frame.mjs "$RAW/18-demo-media-grid.png" /tmp/hero-media.png "Biowatch"
for f in hero-overview hero-explore hero-media; do
  convert "/tmp/$f.png" -resize 1800 "$OUT/$f.png"
done

# --- Guide shots: plain resized copies (styled by site CSS) ---
declare -A SHOTS=(
  [import-first-study]=00-initial-state
  [import-demo-progress]=01-demo-import-progress
  [import-sources]=03-import-page-with-study
  [import-gbif-catalog]=04-gbif-catalog-open
  [import-lila-catalog]=05-lila-catalog-open
  [import-gbif-progress]=06-gbif-import-progress
  [overview-maasai-mara]=09-lila-study-overview
  [overview-mica]=27-mica-overview
  [overview-alpine-tundra]=29-alpine-tundra-overview
  [explore-species-hovercard]=16-explore-species-hovercard
  [explore-marker-hovercard]=17-explore-marker-hovercard
  [explore-map-alpine]=30-alpine-tundra-explore
  [media-table]=12-demo-media
  [media-grid]=18-demo-media-grid
  [gallery-annotation]=20-demo-gallery-viewer
  [gallery-shortcuts]=22-demo-gallery-shortcuts
  [deployments-timeline]=28-waterleidingduinen-deployments
  [sources-tab]=14-demo-sources
  [study-settings]=15-demo-settings
  [export-camtrapdp]=25-camtrapdp-export-modal
  [settings-ai-models]=23-settings-page
  [settings-ai-models-list]=24-settings-models-list
  [explore-map-abundance]=31-alpine-map-abundance
  [explore-map-density]=31-alpine-map-density
  [media-deployment-hovercard]=32-media-deployment-hovercard
  [deployments-line]=33-deployments-line
  [deployments-heatmap]=33-deployments-heatmap
  [deployments-detail]=34-deployments-row-detail
  [overview-species-hovercard]=35-overview-bestcapture-hovercard
)
for name in "${!SHOTS[@]}"; do
  convert "$RAW/${SHOTS[$name]}.png" -resize 1600 "$OUT/$name.png"
done

ls -la "$OUT"
