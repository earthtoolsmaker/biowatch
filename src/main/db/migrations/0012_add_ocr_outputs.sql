CREATE TABLE `ocr_outputs` (
	`id` text PRIMARY KEY NOT NULL,
	`mediaID` text NOT NULL,
	`modelID` text NOT NULL,
	`modelVersion` text NOT NULL,
	`createdAt` text NOT NULL,
	`rawOutput` text,
	FOREIGN KEY (`mediaID`) REFERENCES `media`(`mediaID`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ocr_outputs_mediaID` ON `ocr_outputs` (`mediaID`);