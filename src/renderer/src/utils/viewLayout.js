/**
 * Pure rules for the Explore tab's view-mode toggle.
 *
 * View modes: 'map' | 'gallery' | 'both'. 'both' (map and gallery shown
 * together) is only offered at the Tailwind `lg` breakpoint and up
 * (>= 1024px); below that the window is too narrow to show both at once, so
 * the toggle collapses to map/gallery.
 */
export const VIEW_MODES = ['map', 'gallery', 'both']

/** Modes the toggle should offer at the current breakpoint. */
export function getAvailableViewModes(isLgUp) {
  return isLgUp ? ['map', 'gallery', 'both'] : ['map', 'gallery']
}

/**
 * Coerce a view mode to one valid at the current breakpoint: if 'both' was
 * selected and the window shrank below `lg`, fall back to 'map'.
 */
export function clampViewMode(mode, isLgUp) {
  if (mode === 'both' && !isLgUp) return 'map'
  return mode
}
