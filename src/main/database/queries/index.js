/**
 * Database queries index
 * Re-exports all query functions for unified imports
 */

// Utils
export {
  formatToMatchOriginal,
  getStudyIdFromPath,
  isTimestampBasedDataset,
  checkStudyHasEventIDs,
  createImageDirectoryDatabase
} from './utils.js'

// Deployments
export {
  getDeployments,
  getLocationsActivity,
  insertDeployments,
  getDeploymentsActivity
} from './deployments.js'

// Species
export {
  getSpeciesDistribution,
  getBlankMediaCount,
  getSpeciesTimeseries,
  getSpeciesHeatmapData,
  getSpeciesDailyActivity,
  getDistinctSpecies
} from './species.js'

// Media
export {
  getMedia,
  getFilesData,
  getMediaBboxes,
  getMediaBboxesBatch,
  checkMediaHaveBboxes,
  updateMediaTimestamp,
  insertMedia,
  updateMediaFavorite,
  getMediaTimestampStats
} from './media.js'

// Observations
export {
  updateObservationClassification,
  updateObservationBbox,
  deleteObservation,
  createObservation,
  insertObservations
} from './observations.js'

// Best media selection
export { getTemporalBucket, selectDiverseMedia, getBestMedia } from './best-media.js'
