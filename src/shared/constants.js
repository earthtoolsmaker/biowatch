/**
 * Shared constants used across main and renderer processes.
 */

/**
 * Sentinel value used to represent "blank" media (media with no observations).
 * Uses a UUID-like format to minimize collision risk with actual species names.
 * This value is used in species filtering to request blank media counts.
 */
export const BLANK_SENTINEL = '__blank__f47ac10b-58cc-4372-a567-0e02b2c3d479__'

/**
 * Default sequence gap in seconds.
 * Used when no user preference is set.
 */
export const DEFAULT_SEQUENCE_GAP = 120

/**
 * Behavior categories for the UI.
 * Groups behaviors by type for better organization in dropdown menus.
 * Values must match those in suggestedBehaviorValues from validators.js
 */
export const behaviorCategories = /** @type {const} */ ({
  Movement: ['running', 'walking', 'standing', 'resting', 'alert', 'vigilance'],
  'Feeding (Herbivore)': ['grazing', 'browsing', 'rooting', 'foraging'],
  'Feeding (Predator)': ['hunting', 'stalking', 'chasing', 'feeding', 'carrying prey'],
  Social: ['grooming', 'playing', 'fighting', 'mating', 'nursing'],
  Other: ['drinking', 'scent-marking', 'digging']
})
