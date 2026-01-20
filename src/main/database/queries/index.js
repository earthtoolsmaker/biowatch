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
  getDistinctSpecies,
  getSpeciesDistributionByMedia,
  getSpeciesTimeseriesByMedia,
  getSpeciesHeatmapDataByMedia,
  getSpeciesDailyActivityByMedia
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
