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
  getDeploymentsActivity,
  getSpeciesForDeployment,
  getMediaCountForDeployment,
  getObservationCountForDeployment,
  getBlankMediaCountForDeployment
} from './deployments.js'

// Species
export {
  getSpeciesDistribution,
  getBlankMediaCount,
  getVehicleMediaCount,
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
  getSourcesData,
  getSourceDistribution,
  getMediaBboxes,
  getMediaBboxesBatch,
  checkMediaHaveBboxes,
  studyHasAnyBboxes,
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
  restoreObservation,
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
export {
  getMediaForSequencePagination,
  hasTimestampedMedia,
  getSequenceReviewStatus
} from './sequences.js'

// Overview stats
export { getOverviewStats } from './overview.js'
