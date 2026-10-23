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

## Live scores

The legend describes the **current visible map area**, not the entire study.
It updates while panning and after zooming or resizing the map. Points outside
the viewport are excluded _before_ smoothing; each nonempty group's visible KDE is separately
normalized to sum to 1.

- **Overlap score:** `sum(min(density₁, …, densityₙ))`. Values range from 0
  (no shared density) to 1 (identical distributions).
- **Imbalance ratio:** `sum(abs(density₁ − density₂)) / sum(density₁ + density₂)`.
  When both groups are present, this is total variation distance: 0 means
  identical distributions and 1 means fully separated distributions. It is not
  the signed sum of differences, which would always be zero for normalized
  nonempty distributions.

If a group has no usable observations in the viewport, its density is zero and
its name is listed in the legend. This yields zero overlap (or an imbalance of
1 if only one of two groups is present). If all groups are empty, the legend
shows **No visible data** instead of a score.

The raster intensity is scaled to its current peak for legibility. It has no
absolute count units; use the score to compare shared mass, not color brightness
between different frames. Scores depend on viewport and smoothing and should
not be interpreted as proof of ecological interaction or statistical significance.

## Implementation

The layer uses the existing per-location values from Explore's active analysis
metric and date/time filters. Missing rates and invalid coordinates are omitted.
When RAI is selected, site rates weight the spatial distribution; the surface is
a probability mass grid, not a sum of RAI values reported as a combined rate.

Locations are projected through Leaflet (including wrapped longitude near the
antimeridian), filtered to the viewport, and deposited bilinearly on a grid. A
separable Gaussian convolution, truncated at three standard deviations, produces
each group's KDE. Each nonempty KDE is normalized after clipping at the viewport
edges. The grid is capped at 256 cells per axis to bound computation. Cell size
and screen-space bandwidth vary with zoom; the geographic bandwidth decreases
as the map zooms in.

The result is drawn into a noninteractive canvas in Leaflet's overlay pane. Map
events are coalesced with `requestAnimationFrame`, including live updates during
panning. The previous viewport's raster is hidden until the next redraw; Leaflet
hides the raster during animated zoom transitions. Listeners, scheduled work,
and the canvas are removed when switching encodings or unmounting the map.

## Tests

```sh
node --test test/renderer/comparativeDensity.test.js
npm run build
npx playwright test test/e2e/comparative-map.spec.js
```

The Electron integration tests serve a deterministic Leaflet fixture without
basemap requests or a dataset download. They cover selection constraints,
tooltips, signed raster colors, live scores, pan/zoom/resize, empty viewports,
and overlay cleanup.
