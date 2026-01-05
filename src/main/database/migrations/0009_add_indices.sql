CREATE INDEX `idx_deployments_locationID` ON `deployments` (`locationID`);--> statement-breakpoint
CREATE INDEX `idx_media_deploymentID` ON `media` (`deploymentID`);--> statement-breakpoint
CREATE INDEX `idx_media_timestamp` ON `media` (`timestamp`);--> statement-breakpoint
CREATE INDEX `idx_media_filePath` ON `media` (`filePath`);--> statement-breakpoint
CREATE INDEX `idx_media_folderName` ON `media` (`folderName`);--> statement-breakpoint
CREATE INDEX `idx_model_outputs_runID` ON `model_outputs` (`runID`);--> statement-breakpoint
CREATE INDEX `idx_model_runs_startedAt` ON `model_runs` (`startedAt`);--> statement-breakpoint
CREATE INDEX `idx_observations_mediaID` ON `observations` (`mediaID`);--> statement-breakpoint
CREATE INDEX `idx_observations_deploymentID` ON `observations` (`deploymentID`);--> statement-breakpoint
CREATE INDEX `idx_observations_scientificName` ON `observations` (`scientificName`);--> statement-breakpoint
CREATE INDEX `idx_observations_eventStart` ON `observations` (`eventStart`);--> statement-breakpoint
CREATE INDEX `idx_observations_scientificName_eventStart` ON `observations` (`scientificName`,`eventStart`);--> statement-breakpoint
CREATE INDEX `idx_observations_mediaID_deploymentID` ON `observations` (`mediaID`,`deploymentID`);