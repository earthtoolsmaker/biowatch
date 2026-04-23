/**
 * Database queries index
 * Re-exports all query functions for unified imports
 */

// Utils
export {
  formatToMatchOriginal,
  getStudyIdFromPath,
  checkStudyHasEventIDs,
  createImageDirectoryDatabase
} from './utils.js'

// Deployments
export {
  getDeploymentLocations,
  getAllDeployments,
  getLocationsActivity,
  insertDeployments,
  getDeploymentsActivity
} from './deployments.js'

// Species
export {
  getSpeciesDistribution,
  getBlankMediaCount,
  getDistinctSpecies,
  getSpeciesDistributionByMedia,
  getSpeciesTimeseriesByMedia,
  getSpeciesHeatmapDataByMedia,
  getSequenceAwareSpeciesCountsSQL,
  getSequenceAwareTimeseriesSQL,
  getSequenceAwareHeatmapSQL,
  getSequenceAwareDailyActivitySQL
} from './species.js'

// Media
export {
  getFilesData,
  getMediaBboxes,
  getMediaBboxesBatch,
  checkMediaHaveBboxes,
  getVideoFrameDetections,
  updateMediaTimestamp,
  insertMedia,
  updateMediaFavorite,
  countMediaWithNullTimestamps
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
export {
  getTemporalBucket,
  selectDiverseMedia,
  getBestMedia,
  getBestImagePerSpecies
} from './best-media.js'

// Sequences
export { getMediaForSequencePagination, hasTimestampedMedia } from './sequences.js'
