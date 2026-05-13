/**
 * Registry of pseudo-species: rows that show up in the species list but
 * aren't real biological observations. Two flavors live here:
 *
 *   1. Sentinels (Blank, Vehicle) — synthetic scientificName values the
 *      filter pipeline manufactures so the UI can treat empty media and
 *      vehicle observations as filterable buckets.
 *   2. Processing labels (problem, blurred, ignore, misfire, setup_pickup,
 *      unclassifiable) — strings reviewers attach to frames that aren't
 *      usable observations (broken camera, blurred image, deliberate skip).
 *
 * Both groups render with the same "pseudo" row style: no italic, not
 * muted, with a hover card describing what the bucket represents.
 */

import { BLANK_SENTINEL, VEHICLE_SENTINEL } from './constants.js'

const VEHICLE_PSEUDO = {
  label: 'Vehicle',
  description:
    'Cars, trucks, motorbikes, bicycles, and other vehicles that triggered the camera. Useful for measuring human activity captured incidentally on roads or trails.'
}

const REGISTRY = {
  [BLANK_SENTINEL]: {
    label: 'Blank',
    description:
      'Captures where no animals were recorded — empty frames triggered by motion, wind, or false detections. These often make up most of a camera-trap dataset.'
  },
  // Sentinel + common literal labels datasets use for the vehicle bucket all
  // share one description. Matching is case-insensitive (see lookup below).
  [VEHICLE_SENTINEL]: VEHICLE_PSEUDO,
  vehicle: VEHICLE_PSEUDO,
  car: VEHICLE_PSEUDO,
  truck: VEHICLE_PSEUDO,
  motorcycle: VEHICLE_PSEUDO,
  bike: VEHICLE_PSEUDO,
  bicycle: VEHICLE_PSEUDO,
  problem: {
    label: 'Problem',
    description:
      'Captures marked by reviewers as unusable due to camera malfunction — obstructed lens, broken trigger, or sensor failure.'
  },
  blurred: {
    label: 'Blurred',
    description:
      'Captures too unclear to identify — motion blur, fog, condensation, or focus issues make the content unreadable.'
  },
  ignore: {
    label: 'Ignore',
    description:
      'Captures a reviewer deliberately skipped — test shots, calibration frames, or other non-data triggers.'
  },
  misfire: {
    label: 'Misfire',
    description:
      'False triggers — moving vegetation, falling leaves, shadows, or other non-subject motion that set off the camera.'
  },
  setup_pickup: {
    label: 'Setup / Pickup',
    description:
      'Captures taken while installing or retrieving the camera, typically showing the field team or empty scenes.'
  },
  unclassifiable: {
    label: 'Unclassifiable',
    description:
      "Captures showing something, but the species can't be determined — too distant, too obscured, or visually ambiguous."
  }
}

/**
 * Look up the pseudo-species entry for a given scientificName.
 * Sentinels match exactly; processing labels match case-insensitively after trim.
 * @param {string} scientificName
 * @returns {{ label: string, description: string } | null}
 */
export function getPseudoSpeciesEntry(scientificName) {
  if (!scientificName || typeof scientificName !== 'string') return null
  if (REGISTRY[scientificName]) return REGISTRY[scientificName]
  const normalized = scientificName.trim().toLowerCase()
  return REGISTRY[normalized] || null
}

/**
 * @param {string} scientificName
 * @returns {boolean}
 */
export function isPseudoSpecies(scientificName) {
  return getPseudoSpeciesEntry(scientificName) !== null
}
