# Comparative map

In **Explore → Map**, select at least two taxonomy tags, then choose
**Comparative**. This compares the _shape_ of the selected spatial distributions,
not their absolute abundance. Adding more observations everywhere for one group
does not make it dominate the comparison.

- **Overlap** supports two or more selected taxonomies. Its surface is the
  pointwise minimum of every group's normalized density, not an average of
  pairwise overlaps. The blue sequential ramp shows less → more shared density;
  cells with no shared density are transparent.
- **Difference** requires exactly two selections. It subtracts the second
  selection's normalized density from the first. The diverging ramp uses the
  first group's color for positive values and the second group's color for
  negative values. Equal or absent densities are transparent. Selection order
  and taxonomy names are shown in the legend.

Removing tags below the required number temporarily falls back to Abundance.
Selecting a third tag while Difference is active temporarily uses Overlap.
Neither fallback overwrites the user's preferred mode.

## Area-scoped scores

Use the existing **Filter to this area** button to compare the current map area.
The button captures its bounds as a fixed area filter. Panning, zooming, or
resizing afterwards does **not** change the comparison surface or either score.
Click the button again to replace the filter with the newly visible area.
Clearing the area filter restores the comparison across **all study locations**.
The legend states which scope is being used.

Points outside the applied area are excluded _before_ smoothing; each nonempty
group's KDE is separately normalized to sum to 1. Taxonomy, date/time, and
analysis-metric changes still update the comparison within that same scope.

- **Overlap score:** `sum(min(density₁, …, densityₙ))`. Values range from 0
  (no shared density) to 1 (identical distributions).
- **Imbalance ratio:** `sum(abs(density₁ − density₂)) / sum(density₁ + density₂)`.
  When both groups are present, this is total variation distance: 0 means
  identical distributions and 1 means fully separated distributions. It is not
  the signed sum of differences, which would always be zero for normalized
  nonempty distributions.

If a group has no usable observations in the comparison area, its density is zero
and its name is listed in the legend. This yields zero overlap (or an imbalance
of 1 if only one of two groups is present). If all groups are empty, the legend
shows **No data in comparison area** instead of a score.

The raster intensity is scaled to its current peak for legibility. It has no
absolute count units; use the score to compare shared mass, not color brightness
between different areas. Scores depend on the applied area and smoothing and should
not be interpreted as proof of ecological interaction or statistical significance.

## Implementation

The layer uses the existing per-location values from Explore's active analysis
metric and date/time filters. Missing rates and invalid coordinates are omitted.
When RAI is selected, site rates weight the spatial distribution; the surface is
a probability mass grid, not a sum of RAI values reported as a combined rate.

Locations are projected into a deterministic Web Mercator analysis frame
(including wrapped longitude near the antimeridian), filtered to the applied
area, and deposited bilinearly on a grid. Without an area filter, the frame uses
the padded extent of the study's usable locations, choosing the short longitude
arc for antimeridian-spanning studies. A separable Gaussian convolution,
truncated at three standard deviations, produces each group's KDE. Each nonempty
KDE is normalized after clipping at the analysis area's edges. The grid is capped
at 256 cells per axis. Resolution and bandwidth are derived from a fixed reference
size for the area, never from the current map zoom or pane dimensions.

A canvas produces the raster, which is displayed as a noninteractive Leaflet
image overlay anchored to the analysis bounds. Leaflet handles navigation and
scaling without recomputing the KDEs or scores. A display-only move listener
keeps the image in the nearest world copy; it does not change the analysis.
The image and listener are removed when switching encodings or unmounting.

## Tests

```sh
node --test test/renderer/comparativeDensity.test.js
npm run build
npx playwright test test/e2e/comparative-map.spec.js
```

The Electron integration tests serve a deterministic Leaflet fixture without
basemap requests or a dataset download. They cover selection constraints,
tooltips, signed raster colors, stable scores across pan/zoom/resize, applying,
replacing, and clearing the real area filter, empty areas, and overlay cleanup.
