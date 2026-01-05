CREATE TABLE `deployments` (
	`deploymentID` text PRIMARY KEY NOT NULL,
	`locationID` text,
	`locationName` text,
	`deploymentStart` text,
	`deploymentEnd` text,
	`latitude` real,
	`longitude` real
);
--> statement-breakpoint
CREATE TABLE `media` (
	`mediaID` text PRIMARY KEY NOT NULL,
	`deploymentID` text,
	`timestamp` text,
	`filePath` text,
	`fileName` text,
	FOREIGN KEY (`deploymentID`) REFERENCES `deployments`(`deploymentID`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `observations` (
	`observationID` text PRIMARY KEY NOT NULL,
	`mediaID` text,
	`deploymentID` text,
	`eventID` text,
	`eventStart` text,
	`eventEnd` text,
	`scientificName` text,
	`observationType` text,
	`commonName` text,
	`confidence` real,
	`count` integer,
	`prediction` text,
	`lifeStage` text,
	`age` text,
	`sex` text,
	`behavior` text,
	FOREIGN KEY (`mediaID`) REFERENCES `media`(`mediaID`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`deploymentID`) REFERENCES `deployments`(`deploymentID`) ON UPDATE no action ON DELETE no action
);
