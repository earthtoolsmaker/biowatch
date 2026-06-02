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

/**
 * Initial view mode for the Explore tab. An explicit deep-link view wins when
 * it names a valid mode; otherwise default to 'both' at lg+ and 'map' below.
 * The result is still passed through clampViewMode at render, so a deep-linked
 * 'both' below lg collapses to 'map'.
 */
export function initialViewMode(deepLinkView, isLgUp) {
  if (VIEW_MODES.includes(deepLinkView)) return deepLinkView
  return isLgUp ? 'both' : 'map'
}
