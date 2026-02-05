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
