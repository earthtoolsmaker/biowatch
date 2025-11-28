CREATE TABLE `model_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`modelID` text NOT NULL,
	`modelVersion` text NOT NULL,
	`startedAt` text NOT NULL,
	`status` text DEFAULT 'running'
);
--> statement-breakpoint
CREATE TABLE `model_outputs` (
	`id` text PRIMARY KEY NOT NULL,
	`mediaID` text NOT NULL,
	`runID` text NOT NULL,
	`rawOutput` text,
	FOREIGN KEY (`mediaID`) REFERENCES `media`(`mediaID`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`runID`) REFERENCES `model_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `model_outputs_mediaID_runID_unique` ON `model_outputs` (`mediaID`,`runID`);
--> statement-breakpoint
ALTER TABLE `observations` ADD `modelOutputID` text REFERENCES model_outputs(id);--> statement-breakpoint
ALTER TABLE `observations` ADD `classificationMethod` text;--> statement-breakpoint
ALTER TABLE `observations` ADD `classifiedBy` text;--> statement-breakpoint
ALTER TABLE `observations` ADD `classificationTimestamp` text;